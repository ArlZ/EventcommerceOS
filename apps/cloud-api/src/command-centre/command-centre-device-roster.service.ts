import { Inject, Injectable } from '@nestjs/common';
import type {
  CommandCentreAlert,
  CommandCentreDeviceMetric,
  CommandCentreLocationMetric,
  CommandCentreSnapshot,
} from '@event-commerce/contracts';
import type { MessageEvent } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { from, type Observable, timer } from 'rxjs';
import { distinctUntilChanged, map, switchMap } from 'rxjs/operators';
import { DatabaseService } from '../database/database.service';
import { deviceOperationalStatus, deviceSyncAgeSeconds } from '../sync/device-operational-status';

interface RosterDeviceRow extends QueryResultRow {
  device_id: string;
  event_id: string;
  sales_location_id: string | null;
  sales_location_name: string | null;
  status: 'ACTIVE' | 'REVOKED';
  roster_updated_at: Date | string;
  last_seen_at: Date | string | null;
  last_cloud_delivery_at: Date | string | null;
  edge_backlog_count: number | null;
}

interface RosterVersionRow extends QueryResultRow {
  version_token: string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function severityRank(alert: CommandCentreAlert): number {
  if (alert.severity === 'CRITICAL') return 0;
  if (alert.severity === 'URGENT') return 1;
  if (alert.severity === 'WARNING') return 2;
  return 3;
}

@Injectable()
export class CommandCentreDeviceRosterService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async enrich(eventId: string, snapshot: CommandCentreSnapshot): Promise<CommandCentreSnapshot> {
    const snapshotDeviceIds = snapshot.devices.map((device) => device.deviceId);
    const rows = await this.database.query<RosterDeviceRow>(
      `SELECT roster.device_id,
              roster.event_id::text,
              roster.sales_location_id::text,
              location.name AS sales_location_name,
              roster.status,
              roster.source_updated_at AS roster_updated_at,
              state.last_seen_at,
              state.last_cloud_delivery_at,
              state.edge_backlog_count
       FROM cloud_pos_device_roster roster
       LEFT JOIN sales_locations location
         ON location.id=roster.sales_location_id AND location.event_id=roster.event_id
       LEFT JOIN sync_device_state state ON state.device_id=roster.device_id
       WHERE roster.event_id::text=$1
          OR roster.device_id = ANY($2::text[])
       ORDER BY roster.device_id`,
      [eventId, snapshotDeviceIds],
    );

    const rosteredIds = new Set(rows.map((row) => row.device_id));
    const activeRows = rows.filter((row) => row.event_id === eventId && row.status === 'ACTIVE');
    const legacyDevices = snapshot.devices.filter((device) => !rosteredIds.has(device.deviceId));
    const activeDevices = activeRows.map((row) => this.deviceView(row));
    const devices = [...legacyDevices, ...activeDevices].sort((left, right) =>
      left.deviceId.localeCompare(right.deviceId),
    );

    const salesLocations = this.recalculateLocations(snapshot, devices);
    const alerts = this.recalculateDeviceAlerts(snapshot, devices, activeRows);

    return { ...snapshot, devices, salesLocations, alerts };
  }

  stream(eventId: string): Observable<MessageEvent> {
    return timer(0, 5_000).pipe(
      switchMap(() => from(this.version(eventId))),
      distinctUntilChanged(),
      map((versionToken) => ({
        data: {
          eventId,
          serverTime: new Date().toISOString(),
          versionToken: `device-roster:${versionToken}`,
        },
      }) as MessageEvent),
    );
  }

  private async version(eventId: string): Promise<string> {
    const rows = await this.database.query<RosterVersionRow>(
      `SELECT md5(concat_ws('|',
                count(*)::text,
                count(*) FILTER (WHERE status='ACTIVE')::text,
                coalesce(max(source_updated_at)::text,'')
              )) AS version_token
       FROM cloud_pos_device_roster
       WHERE event_id::text=$1`,
      [eventId],
    );
    return rows[0]?.version_token ?? 'empty';
  }

  private deviceView(row: RosterDeviceRow): CommandCentreDeviceMetric {
    const syncAgeSeconds = deviceSyncAgeSeconds(row.last_seen_at);
    const edgeBacklogCount = row.edge_backlog_count ?? 0;
    return {
      deviceId: row.device_id,
      salesLocationId: row.sales_location_id,
      salesLocationName: row.sales_location_name,
      lastSeenAt: row.last_seen_at === null ? null : iso(row.last_seen_at),
      lastCloudDeliveryAt:
        row.last_cloud_delivery_at === null ? null : iso(row.last_cloud_delivery_at),
      edgeBacklogCount,
      syncAgeSeconds,
      status: deviceOperationalStatus({ syncAgeSeconds, edgeBacklogCount }),
    };
  }

  private recalculateLocations(
    snapshot: CommandCentreSnapshot,
    devices: CommandCentreDeviceMetric[],
  ): CommandCentreLocationMetric[] {
    const previousDeviceIssues = new Map<string, number>();
    for (const device of snapshot.devices) {
      if (device.status === 'HEALTHY') continue;
      const key = device.salesLocationId ?? 'unassigned';
      previousDeviceIssues.set(key, (previousDeviceIssues.get(key) ?? 0) + 1);
    }

    const locations = new Map<string, CommandCentreLocationMetric>(
      snapshot.salesLocations.map((location) => [
        location.salesLocationId,
        {
          ...location,
          tillsHealthy: 0,
          tillsTotal: 0,
          issueCount: Math.max(
            0,
            location.issueCount - (previousDeviceIssues.get(location.salesLocationId) ?? 0),
          ),
        },
      ]),
    );

    for (const device of devices) {
      const key = device.salesLocationId ?? 'unassigned';
      let location = locations.get(key);
      if (!location) {
        location = {
          salesLocationId: key,
          name: device.salesLocationName ?? 'Unassigned',
          transactionCount: 0,
          grossSales: [],
          currentSalesVelocity: [],
          lastSaleAt: null,
          paymentSuccessRate: null,
          tillsHealthy: 0,
          tillsTotal: 0,
          lowestCoverMinutes: null,
          issueCount: 0,
        };
        locations.set(key, location);
      }
      location.tillsTotal += 1;
      if (device.status === 'HEALTHY') location.tillsHealthy += 1;
      else location.issueCount += 1;
    }

    return [...locations.values()];
  }

  private recalculateDeviceAlerts(
    snapshot: CommandCentreSnapshot,
    devices: CommandCentreDeviceMetric[],
    rosterRows: RosterDeviceRow[],
  ): CommandCentreAlert[] {
    const rosterUpdatedAt = new Map(
      rosterRows.map((row) => [row.device_id, iso(row.roster_updated_at)]),
    );
    const alerts = snapshot.alerts.filter((alert) => alert.source !== 'DEVICE');
    for (const device of devices) {
      if (device.status === 'HEALTHY') continue;
      alerts.push({
        id: `device:${device.deviceId}`,
        source: 'DEVICE',
        severity: device.status === 'STALE' ? 'CRITICAL' : 'WARNING',
        state: device.status,
        title:
          device.lastSeenAt === null
            ? `${device.deviceId} has not reported yet`
            : `${device.deviceId} is ${device.status.toLowerCase()}`,
        detail: `${device.salesLocationName ?? 'Unknown location'} • backlog ${device.edgeBacklogCount}`,
        openedAt:
          device.lastSeenAt ??
          rosterUpdatedAt.get(device.deviceId) ??
          snapshot.freshness.generatedAt,
        inventoryAlertId: null,
        actionable: false,
        assignedActorId: null,
      });
    }
    return alerts.sort((left, right) => {
      const rank = severityRank(left) - severityRank(right);
      return rank !== 0 ? rank : left.openedAt.localeCompare(right.openedAt);
    });
  }
}
