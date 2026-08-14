import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import type {
  InventoryEdgeAck,
  InventoryEdgeBatch,
  InventoryEdgeEvent,
} from '@event-commerce/contracts';
import { DatabaseService } from '../database/database.service';

interface StoredEventRow extends QueryResultRow {
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  same_payload: boolean;
}

interface LedgerRow extends QueryResultRow {
  id: string;
  event_id: string;
  inventory_location_id: string;
  sku_id: string;
  movement_type: string;
  quantity_delta: string;
  idempotency_key: string;
}

export interface InventoryOperationsView {
  stock: Array<{
    inventoryLocationId: string;
    skuId: string;
    onHandBase: string;
  }>;
  alerts: Array<Record<string, unknown>>;
  transfers: Array<Record<string, unknown>>;
}

@Injectable()
export class InventoryService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async ingest(batch: InventoryEdgeBatch): Promise<InventoryEdgeAck> {
    const acceptedIds: string[] = [];
    const duplicateIds: string[] = [];
    const conflictIds: string[] = [];

    for (const event of batch.events) {
      const result = await this.database.transaction(async (client) =>
        this.ingestOne(client, event),
      );
      if (result === 'ACCEPTED') acceptedIds.push(event.id);
      else if (result === 'DUPLICATE') duplicateIds.push(event.id);
      else conflictIds.push(event.id);
    }
    return { acceptedIds, duplicateIds, conflictIds, serverTime: new Date().toISOString() };
  }

  async operations(eventId: string): Promise<InventoryOperationsView> {
    const [stock, alerts, transfers] = await Promise.all([
      this.database.query<{ inventory_location_id: string; sku_id: string; on_hand: string }>(
        `SELECT inventory_location_id, sku_id, on_hand::text
         FROM inventory_stock_projection WHERE event_id = $1
         ORDER BY inventory_location_id, sku_id`,
        [eventId],
      ),
      this.database.query<Record<string, unknown>>(
        `SELECT id, alert_type AS "alertType", severity, state,
                inventory_location_id AS "inventoryLocationId", sku_id AS "skuId",
                available_quantity::text AS "availableQuantityBase",
                minutes_of_cover::text AS "minutesOfCover",
                suggested_source_location_id AS "suggestedSourceLocationId",
                suggested_transfer_quantity::text AS "suggestedTransferQuantityBase",
                responsible_actor_id AS "responsibleActorId",
                assigned_actor_id AS "assignedActorId", opened_at AS "openedAt",
                escalate_at AS "escalateAt", source_updated_at AS "sourceUpdatedAt"
         FROM inventory_alert_projection WHERE event_id = $1
         ORDER BY CASE severity WHEN 'CRITICAL' THEN 1 WHEN 'URGENT' THEN 2 ELSE 3 END,
                  CASE state WHEN 'OPEN' THEN 1 WHEN 'ACKNOWLEDGED' THEN 2 WHEN 'ASSIGNED' THEN 3 ELSE 4 END,
                  opened_at DESC`,
        [eventId],
      ),
      this.database.query<Record<string, unknown>>(
        `SELECT id, source_location_id AS "sourceLocationId",
                destination_location_id AS "destinationLocationId", state,
                requested_by_actor_id AS "requestedByActorId",
                assigned_actor_id AS "assignedActorId", lines,
                source_updated_at AS "updatedAt"
         FROM inventory_transfer_projection WHERE event_id = $1
         ORDER BY source_updated_at DESC`,
        [eventId],
      ),
    ]);
    return {
      stock: stock.map((row) => ({
        inventoryLocationId: row.inventory_location_id,
        skuId: row.sku_id,
        onHandBase: row.on_hand,
      })),
      alerts,
      transfers,
    };
  }

  private async ingestOne(
    client: PoolClient,
    event: InventoryEdgeEvent,
  ): Promise<'ACCEPTED' | 'DUPLICATE' | 'CONFLICT'> {
    const serializedPayload = JSON.stringify(event.payload);
    const existing = await client.query<StoredEventRow>(
      `SELECT event_type, aggregate_type, aggregate_id,
              (payload = $2::jsonb) AS same_payload
       FROM inventory_edge_events WHERE id = $1`,
      [event.id, serializedPayload],
    );
    if (existing.rowCount === 1) {
      const row = existing.rows[0]!;
      const same =
        row.event_type === event.eventType &&
        row.aggregate_type === event.aggregateType &&
        row.aggregate_id === event.aggregateId &&
        row.same_payload;
      if (same) {
        const unresolved = await client.query(
          `SELECT 1 FROM inventory_reconciliation_exceptions
           WHERE edge_event_id = $1 AND resolved_at IS NULL LIMIT 1`,
          [event.id],
        );
        return unresolved.rowCount === 1 ? 'CONFLICT' : 'DUPLICATE';
      }
      await this.exception(client, 'INVENTORY_EDGE_EVENT_REUSE', event.id, {
        aggregateId: event.aggregateId,
      });
      return 'CONFLICT';
    }

    const validationError = this.validatePayload(event);
    if (validationError) {
      await this.exception(client, 'INVALID_INVENTORY_EDGE_EVENT', event.id, {
        eventType: event.eventType,
        error: validationError,
      });
      return 'CONFLICT';
    }

    await client.query(
      `INSERT INTO inventory_edge_events(id, event_type, aggregate_type, aggregate_id, payload)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [event.id, event.eventType, event.aggregateType, event.aggregateId, serializedPayload],
    );

    try {
      if (event.eventType === 'INVENTORY_LEDGER_POSTED') await this.applyLedger(client, event);
      if (event.eventType === 'INVENTORY_TRANSFER_UPSERTED') {
        await this.applyTransfer(client, event);
      }
      if (event.eventType === 'INVENTORY_ALERT_UPSERTED') await this.applyAlert(client, event);
      if (event.eventType === 'INVENTORY_COUNT_CLOSED') await this.applyCount(client, event);
      return 'ACCEPTED';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'inventory projection failed';
      await this.exception(client, 'INVENTORY_PROJECTION_CONFLICT', event.id, {
        eventType: event.eventType,
        error: message,
      });
      return 'CONFLICT';
    }
  }

  private async applyLedger(client: PoolClient, event: InventoryEdgeEvent): Promise<void> {
    const payload = event.payload;
    const id = this.string(payload.id, 'ledger.id');
    const existing = await client.query<LedgerRow>(
      `SELECT id, event_id, inventory_location_id, sku_id, movement_type,
              quantity_delta::text, idempotency_key
       FROM inventory_ledger WHERE id = $1`,
      [id],
    );
    const values = {
      eventId: this.string(payload.eventId, 'ledger.eventId'),
      inventoryLocationId: this.string(payload.inventoryLocationId, 'ledger.inventoryLocationId'),
      skuId: this.string(payload.skuId, 'ledger.skuId'),
      movementType: this.string(payload.movementType, 'ledger.movementType'),
      quantityDeltaBase: this.integerString(
        payload.quantityDeltaBase,
        'ledger.quantityDeltaBase',
        false,
      ),
      sourceType: this.string(payload.sourceType, 'ledger.sourceType'),
      sourceId: this.string(payload.sourceId, 'ledger.sourceId'),
      idempotencyKey: this.string(payload.idempotencyKey, 'ledger.idempotencyKey'),
      occurredAt: this.timestamp(payload.occurredAt, 'ledger.occurredAt'),
    };
    if (existing.rowCount === 1) {
      const row = existing.rows[0]!;
      if (
        row.event_id !== values.eventId ||
        row.inventory_location_id !== values.inventoryLocationId ||
        row.sku_id !== values.skuId ||
        row.movement_type !== values.movementType ||
        row.quantity_delta !== values.quantityDeltaBase ||
        row.idempotency_key !== values.idempotencyKey
      ) {
        throw new Error('ledger entry ID reused with different content');
      }
      return;
    }

    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `inventory-ledger-idempotency:${values.idempotencyKey}`,
    ]);
    const idempotencyExisting = await client.query<LedgerRow>(
      `SELECT id, event_id, inventory_location_id, sku_id, movement_type,
              quantity_delta::text, idempotency_key
       FROM inventory_ledger WHERE idempotency_key = $1`,
      [values.idempotencyKey],
    );
    if (idempotencyExisting.rowCount === 1) {
      const row = idempotencyExisting.rows[0]!;
      if (
        row.id !== id ||
        row.event_id !== values.eventId ||
        row.inventory_location_id !== values.inventoryLocationId ||
        row.sku_id !== values.skuId ||
        row.movement_type !== values.movementType ||
        row.quantity_delta !== values.quantityDeltaBase
      ) {
        throw new Error('ledger idempotency key reused with different content');
      }
      return;
    }

    await client.query(
      `INSERT INTO inventory_ledger(
         id, event_id, inventory_location_id, sku_id, movement_type, quantity_delta,
         source_type, source_id, source_event_instance_id, actor_id, device_id, reason,
         occurred_at, idempotency_key, reversal_of_ledger_id, edge_event_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        id,
        values.eventId,
        values.inventoryLocationId,
        values.skuId,
        values.movementType,
        values.quantityDeltaBase,
        values.sourceType,
        values.sourceId,
        this.optionalString(payload.sourceEventInstanceId),
        this.optionalString(payload.actorId),
        this.optionalString(payload.deviceId),
        this.optionalString(payload.reason),
        values.occurredAt,
        values.idempotencyKey,
        this.optionalString(payload.reversalOfLedgerId),
        event.id,
      ],
    );
  }

  private async applyTransfer(client: PoolClient, event: InventoryEdgeEvent): Promise<void> {
    const payload = event.payload;
    const id = this.string(payload.id, 'transfer.id');
    const sourceUpdatedAt = this.timestamp(payload.updatedAt, 'transfer.updatedAt');
    const lines = payload.lines;
    if (!Array.isArray(lines)) throw new Error('transfer.lines must be an array');
    await client.query(
      `INSERT INTO inventory_transfer_projection(
         id, event_id, source_location_id, destination_location_id, state,
         requested_by_actor_id, assigned_actor_id, lines, source_updated_at, edge_event_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
       ON CONFLICT (id) DO UPDATE SET
         state = EXCLUDED.state,
         assigned_actor_id = EXCLUDED.assigned_actor_id,
         lines = EXCLUDED.lines,
         source_updated_at = EXCLUDED.source_updated_at,
         edge_event_id = EXCLUDED.edge_event_id,
         updated_at = now()
       WHERE inventory_transfer_projection.source_updated_at <= EXCLUDED.source_updated_at`,
      [
        id,
        this.string(payload.eventId, 'transfer.eventId'),
        this.string(payload.sourceLocationId, 'transfer.sourceLocationId'),
        this.string(payload.destinationLocationId, 'transfer.destinationLocationId'),
        this.string(payload.state, 'transfer.state'),
        this.optionalString(payload.requestedByActorId),
        this.optionalString(payload.assignedActorId),
        JSON.stringify(lines),
        sourceUpdatedAt,
        event.id,
      ],
    );
  }

  private async applyAlert(client: PoolClient, event: InventoryEdgeEvent): Promise<void> {
    const payload = event.payload;
    const id = this.string(payload.id, 'alert.id');
    const sourceUpdatedAt = this.timestamp(
      payload.sourceUpdatedAt ?? payload.openedAt,
      'alert.sourceUpdatedAt',
    );
    await client.query(
      `INSERT INTO inventory_alert_projection(
         id, alert_type, severity, state, event_id, inventory_location_id, sku_id,
         available_quantity, minutes_of_cover, suggested_source_location_id,
         suggested_transfer_quantity, responsible_actor_id, assigned_actor_id,
         opened_at, escalate_at, source_updated_at, edge_event_id, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,now())
       ON CONFLICT (id) DO UPDATE SET
         alert_type = EXCLUDED.alert_type,
         severity = EXCLUDED.severity,
         state = EXCLUDED.state,
         available_quantity = EXCLUDED.available_quantity,
         minutes_of_cover = EXCLUDED.minutes_of_cover,
         suggested_source_location_id = EXCLUDED.suggested_source_location_id,
         suggested_transfer_quantity = EXCLUDED.suggested_transfer_quantity,
         responsible_actor_id = EXCLUDED.responsible_actor_id,
         assigned_actor_id = EXCLUDED.assigned_actor_id,
         escalate_at = EXCLUDED.escalate_at,
         source_updated_at = EXCLUDED.source_updated_at,
         edge_event_id = EXCLUDED.edge_event_id,
         updated_at = now()
       WHERE inventory_alert_projection.source_updated_at <= EXCLUDED.source_updated_at`,
      [
        id,
        this.string(payload.alertType, 'alert.alertType'),
        this.string(payload.severity, 'alert.severity'),
        this.string(payload.state, 'alert.state'),
        this.string(payload.eventId, 'alert.eventId'),
        this.optionalString(payload.inventoryLocationId),
        this.string(payload.skuId, 'alert.skuId'),
        this.integerString(payload.availableQuantityBase, 'alert.availableQuantityBase'),
        payload.minutesOfCover === null || payload.minutesOfCover === undefined
          ? null
          : Number(payload.minutesOfCover),
        this.optionalString(payload.suggestedSourceLocationId),
        payload.suggestedTransferQuantityBase === null ||
        payload.suggestedTransferQuantityBase === undefined
          ? null
          : this.integerString(
              payload.suggestedTransferQuantityBase,
              'alert.suggestedTransferQuantityBase',
            ),
        this.optionalString(payload.responsibleActorId),
        this.optionalString(payload.assignedActorId),
        this.timestamp(payload.openedAt, 'alert.openedAt'),
        payload.escalateAt ? this.timestamp(payload.escalateAt, 'alert.escalateAt') : null,
        sourceUpdatedAt,
        event.id,
      ],
    );
  }

  private async applyCount(client: PoolClient, event: InventoryEdgeEvent): Promise<void> {
    const payload = event.payload;
    await client.query(
      `INSERT INTO inventory_count_projection(id, event_id, inventory_location_id, state, payload, edge_event_id)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6)
       ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, state = EXCLUDED.state,
         edge_event_id = EXCLUDED.edge_event_id, updated_at = now()`,
      [
        this.string(payload.id, 'count.id'),
        this.string(payload.eventId, 'count.eventId'),
        this.string(payload.inventoryLocationId, 'count.inventoryLocationId'),
        this.string(payload.state, 'count.state'),
        JSON.stringify(payload),
        event.id,
      ],
    );
  }

  private validatePayload(event: InventoryEdgeEvent): string | null {
    if (Object.keys(event.payload).length === 0) return 'payload must not be empty';
    return null;
  }

  private async exception(
    client: PoolClient,
    exceptionType: string,
    edgeEventId: string | null,
    details: Record<string, unknown>,
  ): Promise<void> {
    await client.query(
      `INSERT INTO inventory_reconciliation_exceptions(id, exception_type, edge_event_id, details)
       VALUES ($1,$2,$3,$4::jsonb)`,
      [randomUUID(), exceptionType, edgeEventId, JSON.stringify(details)],
    );
  }

  private string(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`${label} must be a non-empty string`);
    }
    return value.trim();
  }

  private optionalString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  }

  private integerString(value: unknown, label: string, allowZero = true): string {
    const text = this.string(value, label);
    if (!/^-?\d+$/.test(text)) throw new Error(`${label} must be an integer string`);
    if (!allowZero && BigInt(text) === 0n) throw new Error(`${label} must not be zero`);
    return BigInt(text).toString();
  }

  private timestamp(value: unknown, label: string): string {
    const text = this.string(value, label);
    if (Number.isNaN(Date.parse(text))) throw new Error(`${label} must be an RFC3339 timestamp`);
    return new Date(text).toISOString();
  }
}
