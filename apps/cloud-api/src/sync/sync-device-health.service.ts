import { Inject, Injectable } from '@nestjs/common';
import type { DeviceCloudStatus } from '@event-commerce/contracts';
import type { QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';
import { deviceOperationalStatus, deviceSyncAgeSeconds } from './device-operational-status';

interface DeviceHealthRow extends QueryResultRow {
  device_id: string;
  last_seen_at: Date | string | null;
  last_sequence_seen: string | null;
  edge_accepted_through_sequence: string | null;
  edge_backlog_count: number | null;
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
      `WITH active_roster AS (
         SELECT roster.device_id, roster.source_updated_at
         FROM sync_pos_device_roster roster
         WHERE roster.organisation_id=$1 AND roster.status='ACTIVE'
       ), legacy_state AS (
         SELECT state.device_id,
                state.last_seen_at,
                state.last_sequence_seen,
                state.edge_accepted_through_sequence,
                state.edge_backlog_count,
                state.last_cloud_delivery_at
         FROM sync_device_state state
         WHERE state.organisation_id=$1
           AND NOT EXISTS (
             SELECT 1 FROM sync_pos_device_roster roster
             WHERE roster.device_id=state.device_id
           )
       ), combined AS (
         SELECT roster.device_id,
                state.last_seen_at,
                state.last_sequence_seen,
                state.edge_accepted_through_sequence,
                state.edge_backlog_count,
                state.last_cloud_delivery_at
         FROM active_roster roster
         LEFT JOIN sync_device_state state
           ON state.device_id=roster.device_id
          AND state.organisation_id=$1
          AND state.last_seen_at >= roster.source_updated_at
         UNION ALL
         SELECT device_id,last_seen_at,last_sequence_seen,edge_accepted_through_sequence,
                edge_backlog_count,last_cloud_delivery_at
         FROM legacy_state
       )
       SELECT device_id,
              last_seen_at,
              last_sequence_seen::text,
              edge_accepted_through_sequence::text,
              edge_backlog_count,
              last_cloud_delivery_at
       FROM combined
       ORDER BY last_seen_at ASC NULLS FIRST, device_id ASC`,
      [organisationId],
    );

    const now = new Date();
    return rows.map((row) => {
      const syncAgeSeconds = deviceSyncAgeSeconds(row.last_seen_at, now);
      const edgeBacklogCount = row.edge_backlog_count ?? 0;
      const operationalStatus = deviceOperationalStatus({
        syncAgeSeconds,
        edgeBacklogCount,
      });
      return {
        deviceId: row.device_id,
        lastSeenAt:
          row.last_seen_at === null ? null : isoTimestamp(row.last_seen_at, 'last_seen_at'),
        lastSequenceSeen:
          row.last_sequence_seen === null
            ? 0
            : safeSequence(row.last_sequence_seen, 'last_sequence_seen'),
        edgeAcceptedThroughSequence:
          row.edge_accepted_through_sequence === null
            ? 0
            : safeSequence(
                row.edge_accepted_through_sequence,
                'edge_accepted_through_sequence',
              ),
        edgeBacklogCount,
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
