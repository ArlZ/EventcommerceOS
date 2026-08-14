import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import type { SyncEventEnvelope } from '@event-commerce/contracts';
import { consumeRecipe } from '@event-commerce/domain';
import { EdgeDatabaseService } from '../database/database.service';
import { InventoryLedgerService } from './inventory-ledger.service';

interface MappingRow extends QueryResultRow {
  inventory_location_id: string;
}

interface RecipeRow extends QueryResultRow {
  sold_sku_id: string;
  component_sku_id: string;
  quantity_per_sold_unit: string;
}

interface SkuRow extends QueryResultRow {
  sku_id: string;
}

interface SaleLine {
  skuId: string;
  quantity: bigint;
}

interface ParsedSale {
  eventId: string;
  salesLocationId: string;
  orderId: string;
  lines: SaleLine[];
}

interface SaleMovement {
  skuId: string;
  type: 'SALE' | 'RECIPE_CONSUMPTION';
  quantity: bigint;
}

@Injectable()
export class InventorySaleConsumerService {
  constructor(
    @Inject(EdgeDatabaseService) private readonly database: EdgeDatabaseService,
    @Inject(InventoryLedgerService) private readonly ledger: InventoryLedgerService,
  ) {}

  async consume(events: readonly SyncEventEnvelope[]): Promise<string[]> {
    const affected = new Set<string>();
    for (const event of events) {
      if (event.eventType !== 'ORDER_CLOSED_CASH') continue;
      const eventId = await this.consumeOne(event);
      if (eventId) affected.add(eventId);
    }
    return [...affected];
  }

  private async consumeOne(event: SyncEventEnvelope): Promise<string | null> {
    return this.database.transaction(async (client) => {
      const parsed = this.parse(event);
      if (!parsed) {
        await this.exception(client, 'INVALID_SALE_INVENTORY_PAYLOAD', event, null, null, {
          payload: event.payload,
        });
        await this.markProcessed(client, event.eventInstanceId, 'EXCEPTION');
        return null;
      }

      const mapping = await client.query<MappingRow>(
        `SELECT inventory_location_id FROM edge_sales_inventory_mapping
         WHERE event_id = $1 AND sales_location_id = $2`,
        [parsed.eventId, parsed.salesLocationId],
      );
      if (mapping.rowCount !== 1) {
        await this.exception(
          client,
          'MISSING_SALES_INVENTORY_MAPPING',
          event,
          parsed.eventId,
          parsed.salesLocationId,
          {},
        );
        await this.markProcessed(client, event.eventInstanceId, 'EXCEPTION');
        return parsed.eventId;
      }
      const inventoryLocationId = mapping.rows[0]!.inventory_location_id;

      const soldSkuIds = [...new Set(parsed.lines.map((line) => line.skuId))];
      const recipes = await client.query<RecipeRow>(
        `SELECT sold_sku_id, component_sku_id, quantity_per_sold_unit::text
         FROM edge_inventory_recipes
         WHERE event_id = $1 AND sold_sku_id = ANY($2::text[])`,
        [parsed.eventId, soldSkuIds],
      );
      const recipeBySold = new Map<string, RecipeRow[]>();
      for (const recipe of recipes.rows) {
        const existing = recipeBySold.get(recipe.sold_sku_id) ?? [];
        existing.push(recipe);
        recipeBySold.set(recipe.sold_sku_id, existing);
      }

      const configuredSkus = await client.query<SkuRow>(
        `SELECT sku_id FROM edge_inventory_skus
         WHERE event_id = $1`,
        [parsed.eventId],
      );
      const knownSkuIds = new Set(configuredSkus.rows.map((row) => row.sku_id));
      const movements = new Map<string, SaleMovement>();

      for (const line of parsed.lines) {
        const components = recipeBySold.get(line.skuId) ?? [];
        if (components.length === 0) {
          if (!knownSkuIds.has(line.skuId)) {
            await this.exception(
              client,
              'UNCONFIGURED_SALE_SKU',
              event,
              parsed.eventId,
              parsed.salesLocationId,
              { skuId: line.skuId },
            );
            await this.markProcessed(client, event.eventInstanceId, 'EXCEPTION');
            return parsed.eventId;
          }
          this.addMovement(movements, line.skuId, 'SALE', line.quantity);
          continue;
        }
        for (const component of components) {
          if (!knownSkuIds.has(component.component_sku_id)) {
            await this.exception(
              client,
              'UNCONFIGURED_RECIPE_COMPONENT',
              event,
              parsed.eventId,
              parsed.salesLocationId,
              { soldSkuId: line.skuId, componentSkuId: component.component_sku_id },
            );
            await this.markProcessed(client, event.eventInstanceId, 'EXCEPTION');
            return parsed.eventId;
          }
          this.addMovement(
            movements,
            component.component_sku_id,
            'RECIPE_CONSUMPTION',
            consumeRecipe(line.quantity, BigInt(component.quantity_per_sold_unit)),
          );
        }
      }

      const orderedMovements = [...movements.values()].sort((a, b) => {
        const sku = a.skuId.localeCompare(b.skuId);
        return sku !== 0 ? sku : a.type.localeCompare(b.type);
      });
      for (const skuId of [...new Set(orderedMovements.map((movement) => movement.skuId))]) {
        await this.ledger.lockStock(client, parsed.eventId, inventoryLocationId, skuId);
      }
      for (const movement of orderedMovements) {
        await this.ledger.insert(client, {
          eventId: parsed.eventId,
          inventoryLocationId,
          skuId: movement.skuId,
          movementType: movement.type,
          quantityDeltaBase: -movement.quantity,
          sourceType: 'ORDER',
          sourceId: parsed.orderId,
          sourceEventInstanceId: event.eventInstanceId,
          deviceId: event.deviceId,
          reason: 'sale-driven inventory consumption',
          occurredAt: event.occurredAt,
          idempotencyKey: `sale:${event.eventInstanceId}:${movement.type}:${movement.skuId}`,
        });
      }
      await this.markProcessed(client, event.eventInstanceId, 'APPLIED');
      return parsed.eventId;
    });
  }

  private addMovement(
    movements: Map<string, SaleMovement>,
    skuId: string,
    type: SaleMovement['type'],
    quantity: bigint,
  ): void {
    const key = `${type}:${skuId}`;
    const existing = movements.get(key);
    if (existing) existing.quantity += quantity;
    else movements.set(key, { skuId, type, quantity });
  }

  private parse(event: SyncEventEnvelope): ParsedSale | null {
    const payload = event.payload;
    const eventId = typeof payload.eventId === 'string' ? payload.eventId.trim() : '';
    const salesLocationId =
      typeof payload.salesLocationId === 'string' ? payload.salesLocationId.trim() : '';
    const orderId = typeof payload.orderId === 'string' ? payload.orderId.trim() : '';
    if (
      !eventId ||
      !salesLocationId ||
      !orderId ||
      !Array.isArray(payload.lines) ||
      payload.lines.length === 0
    ) {
      return null;
    }
    const lines: SaleLine[] = [];
    for (const raw of payload.lines) {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
      const row = raw as Record<string, unknown>;
      const skuId = typeof row.skuId === 'string' ? row.skuId.trim() : '';
      const quantity = row.quantity;
      if (
        !skuId ||
        typeof quantity !== 'number' ||
        !Number.isSafeInteger(quantity) ||
        quantity <= 0
      ) {
        return null;
      }
      lines.push({ skuId, quantity: BigInt(quantity) });
    }
    return { eventId, salesLocationId, orderId, lines };
  }

  private async markProcessed(
    client: PoolClient,
    eventInstanceId: string,
    outcome: 'APPLIED' | 'EXCEPTION',
  ): Promise<void> {
    await client.query(
      `UPDATE edge_inventory_sale_inbox
       SET processed_at = clock_timestamp(), outcome = $2, last_error = NULL
       WHERE source_event_instance_id = $1`,
      [eventInstanceId, outcome],
    );
  }

  private async exception(
    client: PoolClient,
    type: string,
    event: SyncEventEnvelope,
    eventId: string | null,
    salesLocationId: string | null,
    details: Record<string, unknown>,
  ): Promise<void> {
    await client.query(
      `INSERT INTO edge_inventory_exceptions(
         id, exception_type, event_id, sales_location_id, source_event_instance_id, details
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb)
       ON CONFLICT DO NOTHING`,
      [
        randomUUID(),
        type,
        eventId,
        salesLocationId,
        event.eventInstanceId,
        JSON.stringify(details),
      ],
    );
  }
}
