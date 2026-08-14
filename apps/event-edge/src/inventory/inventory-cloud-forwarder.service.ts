import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import type { InventoryEdgeBatch, InventoryEdgeEvent } from '@event-commerce/contracts';
import { EdgeDatabaseService } from '../database/database.service';
import { retryDelayMs } from '../sync/retry-policy';
import { InventoryCloudTransport } from './inventory-cloud.transport';

interface InventoryOutboxRow extends QueryResultRow {
  id: string;
  event_type: InventoryEdgeEvent['eventType'];
  aggregate_type: InventoryEdgeEvent['aggregateType'];
  aggregate_id: string;
  payload: Record<string, unknown>;
  attempts: number;
  created_at: Date;
}

interface CountRow extends QueryResultRow {
  count: string;
}

@Injectable()
export class InventoryCloudForwarderService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly database: EdgeDatabaseService,
    @Inject(InventoryCloudTransport) private readonly transport: InventoryCloudTransport,
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
    const rows = await this.database.query<InventoryOutboxRow>(
      `SELECT id, event_type, aggregate_type, aggregate_id, payload, attempts, created_at
       FROM edge_inventory_cloud_outbox
       WHERE delivered_at IS NULL AND next_attempt_at <= now()
       ORDER BY next_attempt_at ASC, created_at ASC, id ASC
       LIMIT $1`,
      [Math.max(1, Math.min(100, limit))],
    );
    if (rows.length === 0) return { sent: 0, backlog: await this.backlogCount() };

    const batch: InventoryEdgeBatch = {
      edgeId: process.env.EDGE_ID ?? 'edge-local',
      events: rows.map((row) => ({
        id: row.id,
        eventType: row.event_type,
        aggregateType: row.aggregate_type,
        aggregateId: row.aggregate_id,
        payload: this.orderedPayload(row),
      })),
    };

    try {
      const ack = await this.transport.send(batch);
      const sentIds = new Set(rows.map((row) => row.id));
      const accepted = new Set(ack.acceptedIds);
      const duplicates = new Set(ack.duplicateIds);
      const conflicts = new Set(ack.conflictIds);
      const acknowledged = new Set([...accepted, ...duplicates, ...conflicts]);
      if ([...acknowledged].some((id) => !sentIds.has(id)) || acknowledged.size !== sentIds.size) {
        throw new Error('inventory cloud acknowledgement did not exactly cover the sent batch');
      }

      await this.database.transaction(async (client) => {
        await client.query(
          `UPDATE edge_inventory_cloud_outbox
           SET delivered_at = now(), last_error = NULL
           WHERE id = ANY($1::text[])`,
          [[...acknowledged]],
        );
        for (const id of conflicts) {
          await client.query(
            `INSERT INTO edge_inventory_exceptions(
               id, exception_type, source_event_instance_id, details
             ) VALUES ($1,'CLOUD_INVENTORY_RECONCILIATION_REQUIRED',$2,$3::jsonb)
             ON CONFLICT DO NOTHING`,
            [randomUUID(), id, JSON.stringify({ cloudConflict: true })],
          );
        }
      });
      return { sent: rows.length, backlog: await this.backlogCount() };
    } catch (error) {
      const message =
        error instanceof Error ? error.message.slice(0, 500) : 'inventory cloud sync failed';
      await this.database.transaction(async (client) => {
        for (const row of rows) {
          const attempts = row.attempts + 1;
          await client.query(
            `UPDATE edge_inventory_cloud_outbox
             SET attempts = $2,
                 next_attempt_at = now() + ($3 * interval '1 millisecond'),
                 last_error = $4
             WHERE id = $1 AND delivered_at IS NULL`,
            [row.id, attempts, retryDelayMs(attempts), message],
          );
        }
      });
      return { sent: 0, backlog: await this.backlogCount() };
    }
  }

  async backlogCount(): Promise<number> {
    const rows = await this.database.query<CountRow>(
      'SELECT count(*)::text AS count FROM edge_inventory_cloud_outbox WHERE delivered_at IS NULL',
    );
    return Number.parseInt(rows[0]!.count, 10);
  }

  private orderedPayload(row: InventoryOutboxRow): Record<string, unknown> {
    const sourceUpdatedAt = row.created_at.toISOString();
    if (row.event_type === 'INVENTORY_ALERT_UPSERTED') {
      return { ...row.payload, sourceUpdatedAt };
    }
    if (row.event_type === 'INVENTORY_TRANSFER_UPSERTED') {
      return { ...row.payload, updatedAt: sourceUpdatedAt };
    }
    return row.payload;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.drainOnce();
    } catch {
      // Inventory truth remains durable at Edge; Cloud delivery is recoverable.
    } finally {
      this.running = false;
    }
  }
}
