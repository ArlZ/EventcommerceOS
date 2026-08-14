import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import type { SyncEventEnvelope } from '@event-commerce/contracts';
import { EdgeDatabaseService } from '../database/database.service';
import { InventoryAlertService } from './inventory-alert.service';
import { InventoryNotificationService } from './inventory-notification.service';
import { InventorySaleConsumerService } from './inventory-sale-consumer.service';

interface EventIdRow extends QueryResultRow {
  event_id: string;
}

interface PendingSaleRow extends QueryResultRow {
  source_event_instance_id: string;
  envelope: SyncEventEnvelope;
}

@Injectable()
export class InventoryOperationsLoopService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @Inject(EdgeDatabaseService) private readonly database: EdgeDatabaseService,
    @Inject(InventoryAlertService) private readonly alerts: InventoryAlertService,
    @Inject(InventoryNotificationService)
    private readonly notifications: InventoryNotificationService,
    @Inject(InventorySaleConsumerService)
    private readonly sales: InventorySaleConsumerService,
  ) {}

  onModuleInit(): void {
    if (process.env.INVENTORY_BACKGROUND_DISABLED === 'true' || process.env.NODE_ENV === 'test') {
      return;
    }
    this.timer = setInterval(() => void this.tick(), 30_000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(now = new Date()): Promise<{ eventsEvaluated: number; salesReconciled: number }> {
    const salesReconciled = await this.reconcilePendingSales(now);
    const rows = await this.database.query<EventIdRow>(
      `SELECT event_id FROM edge_inventory_event_config
       WHERE event_end_at >= $1::timestamptz - interval '6 hours'
       ORDER BY event_id`,
      [now.toISOString()],
    );

    for (const row of rows) {
      try {
        await this.alerts.evaluateEvent(row.event_id, now);
      } catch {
        // Alert calculation is recoverable and must never affect inventory truth.
      }
      try {
        await this.alerts.runEscalations(row.event_id, now);
      } catch {
        // Escalation failure is retried on the next cycle.
      }
    }

    try {
      await this.notifications.drainOnce();
    } catch {
      // Notification delivery is isolated from inventory and alert state.
    }
    return { eventsEvaluated: rows.length, salesReconciled };
  }

  private async reconcilePendingSales(now: Date): Promise<number> {
    const pending = await this.database.query<PendingSaleRow>(
      `SELECT source_event_instance_id, envelope
       FROM edge_inventory_sale_inbox
       WHERE processed_at IS NULL AND next_attempt_at <= $1
       ORDER BY next_attempt_at, received_at
       LIMIT 100`,
      [now.toISOString()],
    );

    let reconciled = 0;
    for (const row of pending) {
      try {
        await this.sales.consume([row.envelope]);
        reconciled += 1;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'inventory sale reconciliation failed';
        await this.database.query(
          `UPDATE edge_inventory_sale_inbox
           SET attempts = attempts + 1,
               next_attempt_at = $2::timestamptz + make_interval(secs => LEAST(60, (2 ^ LEAST(attempts + 1, 6))::integer)),
               last_error = $3
           WHERE source_event_instance_id = $1 AND processed_at IS NULL`,
          [row.source_event_instance_id, now.toISOString(), message],
        );
      }
    }
    return reconciled;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.runOnce();
    } finally {
      this.running = false;
    }
  }
}
