import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import type {
  DeviceCloudStatus,
  EdgeCloudBatch,
  EdgePosDeviceRosterEntry,
  SyncEventEnvelope,
} from '@event-commerce/contracts';
import { EdgeDatabaseService } from '../database/database.service';
import { CloudSyncTransport } from './cloud-sync.transport';
import { retryDelayMs } from './retry-policy';

interface OutboxRow extends QueryResultRow {
  event_instance_id: string;
  device_id: string;
  sequence: string;
  envelope: SyncEventEnvelope;
  attempts: number;
}

interface StatusRow extends QueryResultRow {
  device_id: string;
  accepted_through_sequence: string;
  highest_sequence_seen: string;
  last_seen_at: Date;
  last_cloud_delivery_at: Date | null;
  backlog_count: string;
}

interface RosterRow extends QueryResultRow {
  device_id: string;
  event_id: string;
  sales_location_id: string | null;
  register_id: string | null;
  status: 'ACTIVE' | 'REVOKED';
  updated_at: Date;
}

interface CountRow extends QueryResultRow {
  count: string;
}

@Injectable()
export class CloudForwarderService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastRosterSyncAt = 0;
  private readonly rosterHeartbeatMs = 10_000;

  constructor(
    private readonly database: EdgeDatabaseService,
    @Inject(CloudSyncTransport) private readonly transport: CloudSyncTransport,
  ) {}

  onModuleInit(): void {
    if (process.env.EDGE_FORWARDER_DISABLED === 'true') return;
    this.timer = setInterval(() => void this.tick(), 1_000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async drainOnce(limit = 100): Promise<{ sent: number; backlog: number }> {
    const rows = await this.database.query<OutboxRow>(
      `SELECT event_instance_id, device_id, sequence::text, envelope, attempts
       FROM edge_cloud_outbox
       WHERE delivered_at IS NULL AND next_attempt_at <= now()
       ORDER BY next_attempt_at ASC, device_id ASC, sequence ASC
       LIMIT $1`,
      [Math.max(1, Math.min(limit, 100))],
    );
    if (rows.length === 0) return { sent: 0, backlog: await this.backlogCount() };

    const batch: EdgeCloudBatch = {
      edgeId: process.env.EDGE_ID ?? 'edge-local',
      events: rows.map((row) => row.envelope),
      deviceStatuses: await this.deviceStatuses([...new Set(rows.map((row) => row.device_id))]),
      deviceRoster: await this.deviceRoster(),
    };

    try {
      const ack = await this.transport.send(batch);
      const sentIds = new Set(rows.map((row) => row.event_instance_id));
      const accepted = new Set(ack.acceptedEventInstanceIds);
      const duplicates = new Set(ack.duplicateEventInstanceIds);
      const conflicts = new Set(ack.conflictEventInstanceIds);
      const acknowledged = new Set([...accepted, ...duplicates, ...conflicts]);
      if ([...acknowledged].some((id) => !sentIds.has(id)) || acknowledged.size !== sentIds.size) {
        throw new Error('cloud acknowledgement did not exactly cover the sent batch');
      }

      await this.database.transaction(async (client) => {
        const deliveredIds = [...acknowledged];
        await client.query(
          `UPDATE edge_cloud_outbox SET delivered_at = now(), last_error = NULL
           WHERE event_instance_id = ANY($1::text[])`,
          [deliveredIds],
        );
        for (const eventInstanceId of conflicts) {
          const row = rows.find((candidate) => candidate.event_instance_id === eventInstanceId)!;
          await client.query(
            `INSERT INTO edge_reconciliation_exceptions(
               id, exception_type, device_id, sequence, event_instance_id, details
             ) VALUES ($1,'CLOUD_RECONCILIATION_REQUIRED',$2,$3,$4,$5::jsonb)`,
            [
              randomUUID(),
              row.device_id,
              Number.parseInt(row.sequence, 10),
              row.event_instance_id,
              JSON.stringify({ cloudConflict: true }),
            ],
          );
        }
        const deviceIds = [...new Set(rows.map((row) => row.device_id))];
        await client.query(
          `UPDATE edge_device_watermarks SET last_cloud_delivery_at = now()
           WHERE device_id = ANY($1::text[])`,
          [deviceIds],
        );
      });
      this.lastRosterSyncAt = Date.now();
      return { sent: rows.length, backlog: await this.backlogCount() };
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : 'cloud sync failed';
      await this.database.transaction(async (client) => {
        for (const row of rows) {
          const attempts = row.attempts + 1;
          await client.query(
            `UPDATE edge_cloud_outbox
             SET attempts = $2, next_attempt_at = now() + ($3 * interval '1 millisecond'), last_error = $4
             WHERE event_instance_id = $1 AND delivered_at IS NULL`,
            [row.event_instance_id, attempts, retryDelayMs(attempts), message],
          );
        }
      });
      return { sent: 0, backlog: await this.backlogCount() };
    }
  }

  async backlogCount(): Promise<number> {
    const result = await this.database.query<CountRow>(
      'SELECT count(*)::text AS count FROM edge_cloud_outbox WHERE delivered_at IS NULL',
    );
    return Number.parseInt(result[0]!.count, 10);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.drainOnce();
      if (result.backlog === 0 && Date.now() - this.lastRosterSyncAt >= this.rosterHeartbeatMs) {
        await this.syncRosterOnce();
      }
    } catch {
      // Durable rows remain queued; health of the sales path is independent of cloud reachability.
    } finally {
      this.running = false;
    }
  }

  private async syncRosterOnce(): Promise<void> {
    const deviceRoster = await this.deviceRoster();
    if (deviceRoster.length === 0) return;
    const batch: EdgeCloudBatch = {
      edgeId: process.env.EDGE_ID ?? 'edge-local',
      events: [],
      deviceStatuses: [],
      deviceRoster,
    };
    await this.transport.send(batch);
    this.lastRosterSyncAt = Date.now();
  }

  private async deviceStatuses(deviceIds: string[]): Promise<DeviceCloudStatus[]> {
    if (deviceIds.length === 0) return [];
    const rows = await this.database.query<StatusRow>(
      `SELECT w.device_id, w.accepted_through_sequence::text, w.highest_sequence_seen::text,
              w.last_seen_at, w.last_cloud_delivery_at,
              (SELECT count(*) FROM edge_cloud_outbox o
               WHERE o.device_id = w.device_id AND o.delivered_at IS NULL)::text AS backlog_count
       FROM edge_device_watermarks w WHERE w.device_id = ANY($1::text[])`,
      [deviceIds],
    );
    return rows.map((row) => ({
      deviceId: row.device_id,
      lastSeenAt: row.last_seen_at.toISOString(),
      lastSequenceSeen: Number.parseInt(row.highest_sequence_seen, 10),
      edgeAcceptedThroughSequence: Number.parseInt(row.accepted_through_sequence, 10),
      edgeBacklogCount: Number.parseInt(row.backlog_count, 10),
      lastCloudDeliveryAt: row.last_cloud_delivery_at?.toISOString() ?? null,
    }));
  }

  private async deviceRoster(): Promise<EdgePosDeviceRosterEntry[]> {
    const rows = await this.database.query<RosterRow>(
      `SELECT device_id,event_id,sales_location_id,register_id,status,updated_at
       FROM edge_pos_devices
       ORDER BY device_id ASC`,
    );
    return rows.map((row) => ({
      deviceId: row.device_id,
      eventId: row.event_id,
      salesLocationId: row.sales_location_id,
      registerId: row.register_id,
      status: row.status,
      updatedAt: row.updated_at.toISOString(),
    }));
  }
}
