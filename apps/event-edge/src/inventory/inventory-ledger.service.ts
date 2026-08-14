import { ConflictException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import { requireInventoryDelta, type InventoryMovementType } from '@event-commerce/domain';
import { EdgeDatabaseService } from '../database/database.service';
import { InventoryAuthorizationService } from './inventory-authorization.service';
import type { InventoryProjectionRow, ManualMovementInput } from './inventory.types';

interface LedgerInput {
  id?: string;
  eventId: string;
  inventoryLocationId: string;
  skuId: string;
  movementType: InventoryMovementType;
  quantityDeltaBase: bigint;
  sourceType: string;
  sourceId: string;
  sourceEventInstanceId?: string;
  actorId?: string;
  deviceId?: string;
  reason?: string;
  occurredAt: string;
  idempotencyKey: string;
  reversalOfLedgerId?: string;
}

interface LedgerRow extends QueryResultRow {
  id: string;
  event_id: string;
  inventory_location_id: string;
  sku_id: string;
  movement_type: InventoryMovementType;
  quantity_delta: string;
  source_type: string;
  source_id: string;
  source_event_instance_id: string | null;
  actor_id: string | null;
  device_id: string | null;
  reason: string | null;
  occurred_at: Date;
  idempotency_key: string;
  reversal_of_ledger_id: string | null;
}

interface ProjectionDbRow extends QueryResultRow {
  event_id: string;
  inventory_location_id: string;
  sku_id: string;
  on_hand: string;
  inbound: string;
}

@Injectable()
export class InventoryLedgerService {
  constructor(
    private readonly database: EdgeDatabaseService,
    private readonly authorization: InventoryAuthorizationService,
  ) {}

  async postManual(input: ManualMovementInput): Promise<LedgerRow> {
    return this.database.transaction(async (client) => {
      await this.authorization.require(client, input.eventId, input.actorId, 'INVENTORY_MOVE');
      return this.insert(client, {
        id: input.id,
        eventId: input.eventId,
        inventoryLocationId: input.inventoryLocationId,
        skuId: input.skuId,
        movementType: input.movementType,
        quantityDeltaBase: BigInt(input.quantityDeltaBase),
        sourceType: 'MANUAL',
        sourceId: input.id,
        actorId: input.actorId,
        reason: input.reason,
        occurredAt: input.occurredAt,
        idempotencyKey: input.idempotencyKey,
        reversalOfLedgerId: input.reversalOfLedgerId,
      });
    });
  }

  async lockStock(
    client: PoolClient,
    eventId: string,
    inventoryLocationId: string,
    skuId: string,
  ): Promise<void> {
    const lockKey = `${eventId}\u0000${inventoryLocationId}\u0000${skuId}`;
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [lockKey]);
  }

  async insert(client: PoolClient, input: LedgerInput): Promise<LedgerRow> {
    requireInventoryDelta(input.movementType, input.quantityDeltaBase);
    await this.lockStock(client, input.eventId, input.inventoryLocationId, input.skuId);
    const id = input.id ?? randomUUID();
    const inserted = await client.query<LedgerRow>(
      `INSERT INTO edge_inventory_ledger(
         id, event_id, inventory_location_id, sku_id, movement_type, quantity_delta,
         source_type, source_id, source_event_instance_id, actor_id, device_id,
         reason, occurred_at, idempotency_key, reversal_of_ledger_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING *`,
      [
        id,
        input.eventId,
        input.inventoryLocationId,
        input.skuId,
        input.movementType,
        input.quantityDeltaBase.toString(),
        input.sourceType,
        input.sourceId,
        input.sourceEventInstanceId ?? null,
        input.actorId ?? null,
        input.deviceId ?? null,
        input.reason ?? null,
        input.occurredAt,
        input.idempotencyKey,
        input.reversalOfLedgerId ?? null,
      ],
    );

    if (inserted.rowCount === 1) {
      const row = inserted.rows[0]!;
      await this.queueCloud(client, row);
      return row;
    }

    const existing = await client.query<LedgerRow>(
      'SELECT * FROM edge_inventory_ledger WHERE idempotency_key = $1',
      [input.idempotencyKey],
    );
    const row = existing.rows[0];
    if (!row || !this.sameMovement(row, input)) {
      throw new ConflictException('inventory idempotency key was reused with different movement content');
    }
    return row;
  }

  async projection(eventId: string): Promise<InventoryProjectionRow[]> {
    const rows = await this.database.query<ProjectionDbRow>(
      `SELECT p.event_id, p.inventory_location_id, p.sku_id, p.on_hand::text,
              COALESCE(inbound.quantity, 0)::text AS inbound
       FROM edge_inventory_stock_projection p
       LEFT JOIN LATERAL (
         SELECT SUM(l.dispatched_quantity - l.received_quantity)::bigint AS quantity
         FROM edge_stock_transfers t
         JOIN edge_stock_transfer_lines l ON l.transfer_id = t.id
         WHERE t.event_id = p.event_id
           AND t.destination_location_id = p.inventory_location_id
           AND l.sku_id = p.sku_id
           AND t.state = 'IN_TRANSIT'
       ) inbound ON true
       WHERE p.event_id = $1
       ORDER BY p.inventory_location_id, p.sku_id`,
      [eventId],
    );
    return rows.map((row) => ({
      eventId: row.event_id,
      inventoryLocationId: row.inventory_location_id,
      skuId: row.sku_id,
      onHandBase: row.on_hand,
      inboundBase: row.inbound,
      availableBase: row.on_hand,
    }));
  }

  async onHand(
    client: PoolClient,
    eventId: string,
    inventoryLocationId: string,
    skuId: string,
  ): Promise<bigint> {
    const result = await client.query<{ quantity: string }>(
      `SELECT COALESCE(SUM(quantity_delta), 0)::text AS quantity
       FROM edge_inventory_ledger
       WHERE event_id = $1 AND inventory_location_id = $2 AND sku_id = $3`,
      [eventId, inventoryLocationId, skuId],
    );
    return BigInt(result.rows[0]!.quantity);
  }

  private sameMovement(row: LedgerRow, input: LedgerInput): boolean {
    return (
      row.event_id === input.eventId &&
      row.inventory_location_id === input.inventoryLocationId &&
      row.sku_id === input.skuId &&
      row.movement_type === input.movementType &&
      row.quantity_delta === input.quantityDeltaBase.toString() &&
      row.source_type === input.sourceType &&
      row.source_id === input.sourceId &&
      row.source_event_instance_id === (input.sourceEventInstanceId ?? null) &&
      row.actor_id === (input.actorId ?? null) &&
      row.device_id === (input.deviceId ?? null) &&
      row.reason === (input.reason ?? null) &&
      row.reversal_of_ledger_id === (input.reversalOfLedgerId ?? null)
    );
  }

  private async queueCloud(client: PoolClient, row: LedgerRow): Promise<void> {
    await client.query(
      `INSERT INTO edge_inventory_cloud_outbox(id, event_type, aggregate_type, aggregate_id, payload)
       VALUES ($1,'INVENTORY_LEDGER_POSTED','STOCK_LEDGER_ENTRY',$2,$3::jsonb)`,
      [
        `ledger:${row.id}`,
        row.id,
        JSON.stringify({
          id: row.id,
          eventId: row.event_id,
          inventoryLocationId: row.inventory_location_id,
          skuId: row.sku_id,
          movementType: row.movement_type,
          quantityDeltaBase: row.quantity_delta,
          sourceType: row.source_type,
          sourceId: row.source_id,
          sourceEventInstanceId: row.source_event_instance_id,
          actorId: row.actor_id,
          deviceId: row.device_id,
          reason: row.reason,
          occurredAt: row.occurred_at.toISOString(),
          idempotencyKey: row.idempotency_key,
          reversalOfLedgerId: row.reversal_of_ledger_id,
        }),
      ],
    );
  }
}
