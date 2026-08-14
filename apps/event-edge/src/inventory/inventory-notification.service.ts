import { Inject, Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { EdgeDatabaseService } from '../database/database.service';
import { InventoryNotificationTransport } from './inventory-notification.transport';

interface NotificationRow extends QueryResultRow {
  id: string;
  channel: 'IN_APP' | 'SMS' | 'WHATSAPP';
  recipient_actor_id: string;
  payload: Record<string, unknown>;
  attempts: number;
}

@Injectable()
export class InventoryNotificationService {
  constructor(
    @Inject(EdgeDatabaseService) private readonly database: EdgeDatabaseService,
    @Inject(InventoryNotificationTransport)
    private readonly transport: InventoryNotificationTransport,
  ) {}

  async drainOnce(limit = 50): Promise<{ delivered: number; failed: number }> {
    const rows = await this.database.query<NotificationRow>(
      `SELECT id, channel, recipient_actor_id, payload, attempts
       FROM edge_inventory_notification_outbox
       WHERE delivered_at IS NULL AND next_attempt_at <= now()
       ORDER BY created_at ASC LIMIT $1`,
      [Math.max(1, Math.min(100, limit))],
    );
    let delivered = 0;
    let failed = 0;
    for (const row of rows) {
      if (row.channel === 'IN_APP') {
        await this.markDelivered(row.id);
        delivered += 1;
        continue;
      }
      try {
        await this.transport.send({
          channel: row.channel,
          recipientActorId: row.recipient_actor_id,
          payload: row.payload,
        });
        await this.markDelivered(row.id);
        delivered += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'notification delivery failed';
        const nextAttempts = row.attempts + 1;
        const delaySeconds = Math.min(300, 2 ** Math.min(nextAttempts, 8));
        await this.database.query(
          `UPDATE edge_inventory_notification_outbox
           SET attempts = attempts + 1,
               last_error = $2,
               next_attempt_at = now() + ($3 || ' seconds')::interval
           WHERE id = $1 AND delivered_at IS NULL`,
          [row.id, message, delaySeconds],
        );
        failed += 1;
      }
    }
    return { delivered, failed };
  }

  private async markDelivered(id: string): Promise<void> {
    await this.database.query(
      `UPDATE edge_inventory_notification_outbox
       SET delivered_at = now(), last_error = NULL
       WHERE id = $1 AND delivered_at IS NULL`,
      [id],
    );
  }
}
