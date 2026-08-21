import { Inject, Injectable } from '@nestjs/common';
import type { DeviceCloudStatus } from '@event-commerce/contracts';
import type { QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';

interface DeviceHealthRow extends QueryResultRow {
  device_id: string;
  last_seen_at: Date | string;
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
      `SELECT device_id,
              last_seen_at,
              last_sequence_seen::text,
              edge_accepted_through_sequence::text,
              edge_backlog_count,
              last_cloud_delivery_at
       FROM sync_device_state
       WHERE organisation_id=$1
       ORDER BY last_seen_at DESC, device_id ASC`,
      [organisationId],
    );

    return rows.map((row) => ({
      deviceId: row.device_id,
      lastSeenAt: isoTimestamp(row.last_seen_at, 'last_seen_at'),
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
    }));
  }
}
