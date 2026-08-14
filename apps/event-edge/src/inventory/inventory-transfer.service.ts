import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import { requireTransferTransition, type StockTransferState } from '@event-commerce/domain';
import { EdgeDatabaseService } from '../database/database.service';
import { InventoryAuthorizationService } from './inventory-authorization.service';
import { InventoryLedgerService } from './inventory-ledger.service';
import type {
  CreateTransferInput,
  TransferDispatchInput,
  TransferReceiptInput,
  TransferRow,
  TransferTransitionInput,
} from './inventory.types';

interface TransferDbRow extends QueryResultRow {
  id: string;
  event_id: string;
  source_location_id: string;
  destination_location_id: string;
  state: StockTransferState;
  requested_by_actor_id: string;
  assigned_actor_id: string | null;
  request_reason: string;
  updated_at: Date;
  idempotency_key: string | null;
}

interface TransferLineRow extends QueryResultRow {
  sku_id: string;
  requested_quantity: string;
  dispatched_quantity: string;
  received_quantity: string;
}

interface ReceiptRow extends QueryResultRow {
  payload: Record<string, unknown>;
}

@Injectable()
export class InventoryTransferService {
  constructor(
    private readonly database: EdgeDatabaseService,
    private readonly authorization: InventoryAuthorizationService,
    private readonly ledger: InventoryLedgerService,
  ) {}

  async create(input: CreateTransferInput): Promise<TransferRow> {
    return this.database.transaction(async (client) => {
      await this.authorization.require(client, input.eventId, input.actorId, 'TRANSFER_MANAGE');
      const duplicate = await client.query<TransferDbRow>(
        'SELECT * FROM edge_stock_transfers WHERE idempotency_key = $1',
        [input.idempotencyKey],
      );
      if (duplicate.rowCount === 1) {
        const existing = duplicate.rows[0]!;
        if (
          existing.id !== input.id ||
          existing.event_id !== input.eventId ||
          existing.source_location_id !== input.sourceLocationId ||
          existing.destination_location_id !== input.destinationLocationId
        ) {
          throw new ConflictException('transfer idempotency key was reused with different content');
        }
        return this.map(existing);
      }

      await client.query(
        `INSERT INTO edge_stock_transfers(
           id, event_id, source_location_id, destination_location_id, state,
           requested_by_actor_id, request_reason, requested_at, idempotency_key
         ) VALUES ($1,$2,$3,$4,'REQUESTED',$5,$6,$7,$8)`,
        [
          input.id,
          input.eventId,
          input.sourceLocationId,
          input.destinationLocationId,
          input.actorId,
          input.reason,
          input.requestedAt,
          input.idempotencyKey,
        ],
      );
      for (const line of input.lines) {
        await client.query(
          `INSERT INTO edge_stock_transfer_lines(transfer_id, sku_id, requested_quantity)
           VALUES ($1,$2,$3)`,
          [input.id, line.skuId, line.requestedQuantityBase],
        );
      }
      await this.history(client, input.id, null, 'REQUESTED', input.actorId, input.reason, input.requestedAt);
      const row = await this.transfer(client, input.id, true);
      await this.queueCloud(client, row);
      return this.map(row);
    });
  }

  async assign(transferId: string, input: TransferTransitionInput): Promise<TransferRow> {
    if (!input.assignedActorId) throw new Error('assignedActorId is required when assigning a transfer');
    return this.simpleTransition(transferId, input, 'ASSIGNED');
  }

  async startPicking(transferId: string, input: TransferTransitionInput): Promise<TransferRow> {
    return this.simpleTransition(transferId, input, 'PICKING');
  }

  async cancel(transferId: string, input: TransferTransitionInput): Promise<TransferRow> {
    if (!input.reason) throw new Error('cancelling a transfer requires a reason');
    return this.simpleTransition(transferId, input, 'CANCELLED');
  }

  async dispatch(transferId: string, input: TransferDispatchInput): Promise<TransferRow> {
    return this.database.transaction(async (client) => {
      const transfer = await this.transfer(client, transferId, true);
      await this.authorization.require(client, transfer.event_id, input.actorId, 'TRANSFER_MANAGE');
      requireTransferTransition(transfer.state, 'IN_TRANSIT');
      const lines = await this.lines(client, transferId);
      const requested = new Map(lines.map((line) => [line.sku_id, BigInt(line.requested_quantity)]));
      const supplied = new Map(input.quantities.map((line) => [line.skuId, BigInt(line.quantityBase)]));
      if (requested.size !== supplied.size) throw new Error('dispatch must include every requested transfer line');
      for (const [skuId, quantity] of requested) {
        if (supplied.get(skuId) !== quantity) {
          throw new Error('MVP dispatch quantity must exactly match the requested transfer quantity');
        }
        const onHand = await this.ledger.onHand(client, transfer.event_id, transfer.source_location_id, skuId);
        if (onHand < quantity) {
          throw new ConflictException(`insufficient source stock to dispatch SKU ${skuId}`);
        }
      }

      for (const [skuId, quantity] of requested) {
        await this.ledger.insert(client, {
          eventId: transfer.event_id,
          inventoryLocationId: transfer.source_location_id,
          skuId,
          movementType: 'TRANSFER_OUT',
          quantityDeltaBase: -quantity,
          sourceType: 'TRANSFER',
          sourceId: transfer.id,
          actorId: input.actorId,
          reason: input.reason ?? 'transfer dispatch',
          occurredAt: input.occurredAt,
          idempotencyKey: `transfer:${transfer.id}:dispatch:${skuId}`,
        });
        await client.query(
          `UPDATE edge_stock_transfer_lines
           SET dispatched_quantity = requested_quantity
           WHERE transfer_id = $1 AND sku_id = $2`,
          [transfer.id, skuId],
        );
      }
      await client.query(
        `UPDATE edge_stock_transfers
         SET state = 'IN_TRANSIT', in_transit_at = $2, updated_at = now()
         WHERE id = $1`,
        [transfer.id, input.occurredAt],
      );
      await this.history(client, transfer.id, transfer.state, 'IN_TRANSIT', input.actorId, input.reason, input.occurredAt);
      const updated = await this.transfer(client, transfer.id, false);
      await this.queueCloud(client, updated);
      return this.map(updated);
    });
  }

  async receive(transferId: string, input: TransferReceiptInput): Promise<TransferRow> {
    return this.database.transaction(async (client) => {
      const transfer = await this.transfer(client, transferId, true);
      await this.authorization.require(client, transfer.event_id, input.actorId, 'TRANSFER_MANAGE');
      if (transfer.state !== 'IN_TRANSIT') throw new Error('stock can only be received from an in-transit transfer');

      const existingReceipt = await client.query<ReceiptRow>(
        'SELECT payload FROM edge_stock_transfer_receipts WHERE idempotency_key = $1',
        [input.idempotencyKey],
      );
      const canonicalPayload = JSON.stringify(input.quantities.map((line) => ({ skuId: line.skuId, quantityBase: line.quantityBase })));
      if (existingReceipt.rowCount === 1) {
        if (JSON.stringify(existingReceipt.rows[0]!.payload) !== canonicalPayload) {
          throw new ConflictException('transfer receipt idempotency key was reused with different content');
        }
        return this.map(transfer);
      }

      const lines = await this.lines(client, transfer.id);
      const bySku = new Map(lines.map((line) => [line.sku_id, line]));
      for (const receipt of input.quantities) {
        const line = bySku.get(receipt.skuId);
        if (!line) throw new Error(`SKU ${receipt.skuId} is not part of this transfer`);
        const quantity = BigInt(receipt.quantityBase);
        const outstanding = BigInt(line.dispatched_quantity) - BigInt(line.received_quantity);
        if (quantity > outstanding) throw new ConflictException(`receipt exceeds outstanding quantity for SKU ${receipt.skuId}`);
      }

      await client.query(
        `INSERT INTO edge_stock_transfer_receipts(idempotency_key, transfer_id, actor_id, payload, received_at)
         VALUES ($1,$2,$3,$4::jsonb,$5)`,
        [input.idempotencyKey, transfer.id, input.actorId, canonicalPayload, input.receivedAt],
      );
      for (const receipt of input.quantities) {
        const quantity = BigInt(receipt.quantityBase);
        await this.ledger.insert(client, {
          eventId: transfer.event_id,
          inventoryLocationId: transfer.destination_location_id,
          skuId: receipt.skuId,
          movementType: 'TRANSFER_IN',
          quantityDeltaBase: quantity,
          sourceType: 'TRANSFER',
          sourceId: transfer.id,
          actorId: input.actorId,
          reason: input.reason ?? 'transfer receipt',
          occurredAt: input.receivedAt,
          idempotencyKey: `transfer:${transfer.id}:receipt:${input.idempotencyKey}:${receipt.skuId}`,
        });
        await client.query(
          `UPDATE edge_stock_transfer_lines
           SET received_quantity = received_quantity + $3
           WHERE transfer_id = $1 AND sku_id = $2`,
          [transfer.id, receipt.skuId, quantity.toString()],
        );
      }

      const after = await this.lines(client, transfer.id);
      const complete = after.every((line) => line.received_quantity === line.dispatched_quantity);
      if (complete) {
        await client.query(
          `UPDATE edge_stock_transfers
           SET state = 'RECEIVED', received_at = $2, updated_at = now()
           WHERE id = $1`,
          [transfer.id, input.receivedAt],
        );
        await this.history(client, transfer.id, 'IN_TRANSIT', 'RECEIVED', input.actorId, input.reason, input.receivedAt);
      } else {
        await client.query('UPDATE edge_stock_transfers SET updated_at = now() WHERE id = $1', [transfer.id]);
      }
      const updated = await this.transfer(client, transfer.id, false);
      await this.queueCloud(client, updated);
      return this.map(updated);
    });
  }

  async list(eventId: string): Promise<TransferRow[]> {
    const rows = await this.database.query<TransferDbRow>(
      'SELECT * FROM edge_stock_transfers WHERE event_id = $1 ORDER BY updated_at DESC',
      [eventId],
    );
    return rows.map((row) => this.map(row));
  }

  private async simpleTransition(
    transferId: string,
    input: TransferTransitionInput,
    toState: StockTransferState,
  ): Promise<TransferRow> {
    return this.database.transaction(async (client) => {
      const transfer = await this.transfer(client, transferId, true);
      await this.authorization.require(client, transfer.event_id, input.actorId, 'TRANSFER_MANAGE');
      requireTransferTransition(transfer.state, toState);
      const assignments = toState === 'ASSIGNED' ? ', assigned_actor_id = $4, assigned_at = $3' : '';
      const milestone = toState === 'PICKING' ? ', picking_at = $3' : toState === 'CANCELLED' ? ', cancelled_at = $3' : '';
      const values = toState === 'ASSIGNED'
        ? [transfer.id, toState, input.occurredAt, input.assignedActorId]
        : [transfer.id, toState, input.occurredAt];
      await client.query(
        `UPDATE edge_stock_transfers SET state = $2, updated_at = now()${assignments}${milestone} WHERE id = $1`,
        values,
      );
      await this.history(client, transfer.id, transfer.state, toState, input.actorId, input.reason, input.occurredAt);
      const updated = await this.transfer(client, transfer.id, false);
      await this.queueCloud(client, updated);
      return this.map(updated);
    });
  }

  private async transfer(client: PoolClient, id: string, lock: boolean): Promise<TransferDbRow> {
    const result = await client.query<TransferDbRow>(
      `SELECT * FROM edge_stock_transfers WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
      [id],
    );
    if (result.rowCount !== 1) throw new NotFoundException('stock transfer not found');
    return result.rows[0]!;
  }

  private async lines(client: PoolClient, transferId: string): Promise<TransferLineRow[]> {
    const result = await client.query<TransferLineRow>(
      `SELECT sku_id, requested_quantity::text, dispatched_quantity::text, received_quantity::text
       FROM edge_stock_transfer_lines WHERE transfer_id = $1 ORDER BY sku_id`,
      [transferId],
    );
    return result.rows;
  }

  private async history(
    client: PoolClient,
    transferId: string,
    from: StockTransferState | null,
    to: StockTransferState,
    actorId: string,
    reason: string | undefined,
    occurredAt: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO edge_stock_transfer_history(id, transfer_id, from_state, to_state, actor_id, reason, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [randomUUID(), transferId, from, to, actorId, reason ?? null, occurredAt],
    );
  }

  private async queueCloud(client: PoolClient, transfer: TransferDbRow): Promise<void> {
    const lines = await this.lines(client, transfer.id);
    await client.query(
      `INSERT INTO edge_inventory_cloud_outbox(id, event_type, aggregate_type, aggregate_id, payload)
       VALUES ($1,'INVENTORY_TRANSFER_UPSERTED','STOCK_TRANSFER',$2,$3::jsonb)`,
      [
        randomUUID(),
        transfer.id,
        JSON.stringify({
          id: transfer.id,
          eventId: transfer.event_id,
          sourceLocationId: transfer.source_location_id,
          destinationLocationId: transfer.destination_location_id,
          state: transfer.state,
          requestedByActorId: transfer.requested_by_actor_id,
          assignedActorId: transfer.assigned_actor_id,
          updatedAt: transfer.updated_at.toISOString(),
          lines: lines.map((line) => ({
            skuId: line.sku_id,
            requestedQuantityBase: line.requested_quantity,
            dispatchedQuantityBase: line.dispatched_quantity,
            receivedQuantityBase: line.received_quantity,
          })),
        }),
      ],
    );
  }

  private map(row: TransferDbRow): TransferRow {
    return {
      id: row.id,
      eventId: row.event_id,
      sourceLocationId: row.source_location_id,
      destinationLocationId: row.destination_location_id,
      state: row.state,
      requestedByActorId: row.requested_by_actor_id,
      assignedActorId: row.assigned_actor_id,
      updatedAt: row.updated_at.toISOString(),
    };
  }
}
