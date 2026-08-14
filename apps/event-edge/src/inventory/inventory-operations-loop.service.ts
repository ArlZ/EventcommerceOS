import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { EdgeDatabaseService } from '../database/database.service';
import { InventoryAlertService } from './inventory-alert.service';
import { InventoryNotificationService } from './inventory-notification.service';

interface EventIdRow extends QueryResultRow {
  event_id: string;
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
  ) {}

  onModuleInit(): void {
    if (
      process.env.INVENTORY_BACKGROUND_DISABLED === 'true' ||
      process.env.NODE_ENV === 'test'
    ) {
      return;
    }
    this.timer = setInterval(() => void this.tick(), 30_000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(now = new Date()): Promise<{ eventsEvaluated: number }> {
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
    return { eventsEvaluated: rows.length };
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
