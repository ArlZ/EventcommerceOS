import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import { EdgeDatabaseService } from '../database/database.service';
import { InventoryAuthorizationService } from './inventory-authorization.service';
import { InventoryLedgerService } from './inventory-ledger.service';
import type { CloseStockCountInput, CreateStockCountInput } from './inventory.types';

interface CountRow extends QueryResultRow {
  id: string;
  event_id: string;
  inventory_location_id: string;
  state: 'OPEN' | 'CLOSED';
  opened_by_actor_id: string;
  opened_at: Date;
  closed_by_actor_id: string | null;
  closed_at: Date | null;
  reason: string | null;
}

interface CountLineRow extends QueryResultRow {
  sku_id: string;
  counted_quantity: string;
  expected_quantity_at_close: string | null;
  adjustment_ledger_id: string | null;
}

export interface StockCountResult {
  id: string;
  eventId: string;
  inventoryLocationId: string;
  state: 'OPEN' | 'CLOSED';
  lines: Array<{
    skuId: string;
    countedQuantityBase: string;
    expectedQuantityBase: string | null;
    varianceBase: string | null;
  }>;
}

@Injectable()
export class InventoryCountService {
  constructor(
    private readonly database: EdgeDatabaseService,
    private readonly authorization: InventoryAuthorizationService,
    private readonly ledger: InventoryLedgerService,
  ) {}

  async create(input: CreateStockCountInput): Promise<StockCountResult> {
    return this.database.transaction(async (client) => {
      await this.authorization.require(client, input.eventId, input.actorId, 'COUNT_MANAGE');
      const existing = await client.query<CountRow>('SELECT * FROM edge_stock_counts WHERE id = $1', [
        input.id,
      ]);
      if (existing.rowCount === 1) {
        const row = existing.rows[0]!;
        if (
          row.event_id !== input.eventId ||
          row.inventory_location_id !== input.inventoryLocationId
        ) {
          throw new ConflictException('stock count ID was reused with different content');
        }
        return this.result(client, row);
      }

      await client.query(
        `INSERT INTO edge_stock_counts(
           id, event_id, inventory_location_id, state, opened_by_actor_id,
           opened_at, reason
         ) VALUES ($1,$2,$3,'OPEN',$4,$5,$6)`,
        [
          input.id,
          input.eventId,
          input.inventoryLocationId,
          input.actorId,
          input.openedAt,
          input.reason,
        ],
      );
      for (const line of [...input.lines].sort((a, b) => a.skuId.localeCompare(b.skuId))) {
        await client.query(
          `INSERT INTO edge_stock_count_lines(count_id, sku_id, counted_quantity)
           VALUES ($1,$2,$3)`,
          [input.id, line.skuId, line.countedQuantityBase],
        );
      }
      return this.result(client, await this.count(client, input.id, false));
    });
  }

  async close(countId: string, input: CloseStockCountInput): Promise<StockCountResult> {
    return this.database.transaction(async (client) => {
      const count = await this.count(client, countId, true);
      await this.authorization.require(client, count.event_id, input.actorId, 'COUNT_MANAGE');
      if (count.state === 'CLOSED') return this.result(client, count);
      const lines = await this.lines(client, count.id);

      for (const line of lines) {
        await this.ledger.lockStock(
          client,
          count.event_id,
          count.inventory_location_id,
          line.sku_id,
        );
      }

      for (const line of lines) {
        const expected = await this.ledger.onHand(
          client,
          count.event_id,
          count.inventory_location_id,
          line.sku_id,
        );
        const counted = BigInt(line.counted_quantity);
        const variance = counted - expected;
        let ledgerId: string | null = null;
        if (variance !== 0n) {
          const movement = await this.ledger.insert(client, {
            eventId: count.event_id,
            inventoryLocationId: count.inventory_location_id,
            skuId: line.sku_id,
            movementType: 'COUNT_ADJUSTMENT',
            quantityDeltaBase: variance,
            sourceType: 'STOCK_COUNT',
            sourceId: count.id,
            actorId: input.actorId,
            reason: input.reason,
            occurredAt: input.closedAt,
            idempotencyKey: `stock-count:${count.id}:${line.sku_id}`,
          });
          ledgerId = movement.id;
        }
        await client.query(
          `UPDATE edge_stock_count_lines
           SET expected_quantity_at_close = $3, adjustment_ledger_id = $4
           WHERE count_id = $1 AND sku_id = $2`,
          [count.id, line.sku_id, expected.toString(), ledgerId],
        );
      }
      await client.query(
        `UPDATE edge_stock_counts
         SET state = 'CLOSED', closed_by_actor_id = $2, closed_at = $3, reason = $4
         WHERE id = $1`,
        [count.id, input.actorId, input.closedAt, input.reason],
      );
      const closed = await this.count(client, count.id, false);
      await this.queueCloud(client, closed);
      return this.result(client, closed);
    });
  }

  private async count(client: PoolClient, id: string, lock: boolean): Promise<CountRow> {
    const result = await client.query<CountRow>(
      `SELECT * FROM edge_stock_counts WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
      [id],
    );
    if (result.rowCount !== 1) throw new NotFoundException('stock count not found');
    return result.rows[0]!;
  }

  private async lines(client: PoolClient, countId: string): Promise<CountLineRow[]> {
    const result = await client.query<CountLineRow>(
      `SELECT sku_id, counted_quantity::text, expected_quantity_at_close::text, adjustment_ledger_id
       FROM edge_stock_count_lines WHERE count_id = $1 ORDER BY sku_id`,
      [countId],
    );
    return result.rows;
  }

  private async result(client: PoolClient, count: CountRow): Promise<StockCountResult> {
    const lines = await this.lines(client, count.id);
    return {
      id: count.id,
      eventId: count.event_id,
      inventoryLocationId: count.inventory_location_id,
      state: count.state,
      lines: lines.map((line) => {
        const expected = line.expected_quantity_at_close;
        return {
          skuId: line.sku_id,
          countedQuantityBase: line.counted_quantity,
          expectedQuantityBase: expected,
          varianceBase:
            expected === null
              ? null
              : (BigInt(line.counted_quantity) - BigInt(expected)).toString(),
        };
      }),
    };
  }

  private async queueCloud(client: PoolClient, count: CountRow): Promise<void> {
    const lines = await this.lines(client, count.id);
    await client.query(
      `INSERT INTO edge_inventory_cloud_outbox(id, event_type, aggregate_type, aggregate_id, payload)
       VALUES ($1,'INVENTORY_COUNT_CLOSED','STOCK_COUNT',$2,$3::jsonb)`,
      [
        randomUUID(),
        count.id,
        JSON.stringify({
          id: count.id,
          eventId: count.event_id,
          inventoryLocationId: count.inventory_location_id,
          state: count.state,
          openedByActorId: count.opened_by_actor_id,
          openedAt: count.opened_at.toISOString(),
          closedByActorId: count.closed_by_actor_id,
          closedAt: count.closed_at?.toISOString() ?? null,
          reason: count.reason,
          lines: lines.map((line) => ({
            skuId: line.sku_id,
            countedQuantityBase: line.counted_quantity,
            expectedQuantityBase: line.expected_quantity_at_close,
            adjustmentLedgerId: line.adjustment_ledger_id,
          })),
        }),
      ],
    );
  }
}
