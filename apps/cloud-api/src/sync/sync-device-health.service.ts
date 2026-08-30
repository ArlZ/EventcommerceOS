import { Inject, Injectable } from '@nestjs/common';
import type { DeviceCloudStatus } from '@event-commerce/contracts';
import type { QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';
import { deviceOperationalStatus, deviceSyncAgeSeconds } from './device-operational-status';

interface DeviceHealthRow extends QueryResultRow {
  device_id: string;
  last_seen_at: Date | string | null;
  last_sequence_seen: string;
  edge_accepted_through_sequence: string;
  edge_backlog_count: number;
  last_cloud_delivery_at: Date | string | null;
}

function safeSequence(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`stored ${field} is outside the supported safe-integer range`);
  }
  return parsed;
}

function isoTimestamp(value: Date | string, field: string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`stored ${field} is not a valid timestamp`);
  return parsed.toISOString();
}

@Injectable()
export class SyncDeviceHealthService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async listForOrganisation(organisationId: string): Promise<DeviceCloudStatus[]> {
    const rows = await this.database.query<DeviceHealthRow>(
      `WITH device_scope AS (
         SELECT roster.device_id,roster.edge_id,roster.source_updated_at
         FROM cloud_pos_device_roster roster
         WHERE roster.organisation_id=$1 AND roster.status='ACTIVE'
         UNION ALL
         SELECT state.device_id,state.edge_id,NULL::timestamptz AS source_updated_at
         FROM sync_device_state state
         WHERE state.organisation_id=$1
           AND NOT EXISTS (
             SELECT 1 FROM cloud_pos_device_roster roster WHERE roster.device_id=state.device_id
           )
       )
       SELECT scope.device_id,
              state.last_seen_at,
              coalesce(state.last_sequence_seen,0)::text AS last_sequence_seen,
              coalesce(state.edge_accepted_through_sequence,0)::text AS edge_accepted_through_sequence,
              coalesce(state.edge_backlog_count,0) AS edge_backlog_count,
              state.last_cloud_delivery_at
       FROM device_scope scope
       LEFT JOIN sync_device_state state
         ON state.device_id=scope.device_id
        AND (
          scope.source_updated_at IS NULL
          OR (
            state.organisation_id=$1
            AND state.edge_id=scope.edge_id
            AND state.last_seen_at >= scope.source_updated_at
          )
        )
       ORDER BY state.last_seen_at ASC NULLS FIRST, scope.device_id ASC`,
      [organisationId],
    );

    const now = new Date();
    return rows.map((row) => {
      const syncAgeSeconds = deviceSyncAgeSeconds(row.last_seen_at, now);
      const operationalStatus = deviceOperationalStatus({
        syncAgeSeconds,
        edgeBacklogCount: row.edge_backlog_count,
      });
      return {
        deviceId: row.device_id,
        lastSeenAt:
          row.last_seen_at === null ? null : isoTimestamp(row.last_seen_at, 'last_seen_at'),
        lastSequenceSeen: safeSequence(row.last_sequence_seen, 'last_sequence_seen'),
        edgeAcceptedThroughSequence: safeSequence(
          row.edge_accepted_through_sequence,
          'edge_accepted_through_sequence',
        ),
        edgeBacklogCount: row.edge_backlog_count,
        lastCloudDeliveryAt:
          row.last_cloud_delivery_at === null
            ? null
            : isoTimestamp(row.last_cloud_delivery_at, 'last_cloud_delivery_at'),
        syncAgeSeconds,
        operationalStatus,
      };
    });
  }
}
