import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { EdgeDatabaseService } from '../src/database/database.service';
import { InventoryConfigurationService } from '../src/inventory/inventory-configuration.service';
import { InventoryCountService } from '../src/inventory/inventory-count.service';
import { InventoryLedgerService } from '../src/inventory/inventory-ledger.service';
import { InventorySaleConsumerService } from '../src/inventory/inventory-sale-consumer.service';
import {
  beerSkuId,
  closedSale,
  cocktailSkuId,
  ginSkuId,
  installInventoryFixture,
  inventoryEventId,
  mainLocationId,
  operatorActorId,
  receipt,
  resetInventory,
  tonicSkuId,
} from './inventory-fixture';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration('inventory ledger and sale consumption', () => {
  let app: INestApplication;
  let database: EdgeDatabaseService;
  let configuration: InventoryConfigurationService;
  let ledger: InventoryLedgerService;
  let sales: InventorySaleConsumerService;
  let counts: InventoryCountService;

  beforeAll(async () => {
    process.env.EDGE_FORWARDER_DISABLED = 'true';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    database = moduleRef.get(EdgeDatabaseService);
    configuration = moduleRef.get(InventoryConfigurationService);
    ledger = moduleRef.get(InventoryLedgerService);
    sales = moduleRef.get(InventorySaleConsumerService);
    counts = moduleRef.get(InventoryCountService);
    await app.init();
  });

  beforeEach(async () => {
    await resetInventory(database);
    await installInventoryFixture(configuration);
  });

  afterAll(async () => {
    await app.close();
    delete process.env.EDGE_FORWARDER_DISABLED;
  });

  it('replays a closed sale twenty times with one durable depletion', async () => {
    await receipt(ledger, mainLocationId, beerSkuId, 100n, 'beer-main');
    const sale = closedSale({
      eventInstanceId: 'sale-replay-001',
      lines: [{ skuId: beerSkuId, quantity: 2 }],
    });

    for (let attempt = 0; attempt < 20; attempt += 1) {
      await sales.consume([sale]);
    }

    const saleRows = await database.query<{ count: string; quantity: string }>(
      `SELECT count(*)::text AS count, COALESCE(SUM(quantity_delta), 0)::text AS quantity
       FROM edge_inventory_ledger
       WHERE source_event_instance_id = $1 AND movement_type = 'SALE'`,
      [sale.eventInstanceId],
    );
    const stock = await database.query<{ on_hand: string }>(
      `SELECT on_hand::text FROM edge_inventory_stock_projection
       WHERE event_id = $1 AND inventory_location_id = $2 AND sku_id = $3`,
      [inventoryEventId, mainLocationId, beerSkuId],
    );

    expect(saleRows[0]).toEqual({ count: '1', quantity: '-2' });
    expect(stock[0]!.on_hand).toBe('98');
  });

  it('converts a recipe into exact integer component depletion', async () => {
    await receipt(ledger, mainLocationId, ginSkuId, 1_000n, 'gin-main');
    await receipt(ledger, mainLocationId, tonicSkuId, 20n, 'tonic-main');

    await sales.consume([
      closedSale({
        eventInstanceId: 'recipe-sale-002',
        lines: [{ skuId: cocktailSkuId, quantity: 3 }],
      }),
    ]);

    const rows = await database.query<{ sku_id: string; quantity: string }>(
      `SELECT sku_id, SUM(quantity_delta)::text AS quantity
       FROM edge_inventory_ledger
       WHERE source_event_instance_id = 'recipe-sale-002'
       GROUP BY sku_id ORDER BY sku_id`,
    );
    expect(rows).toEqual([
      { sku_id: ginSkuId, quantity: '-150' },
      { sku_id: tonicSkuId, quantity: '-3' },
    ]);
  });

  it('closes a physical count with a compensating adjustment and preserves prior history', async () => {
    await receipt(ledger, mainLocationId, beerSkuId, 100n, 'count-beer');
    await counts.create({
      id: 'count-001',
      eventId: inventoryEventId,
      inventoryLocationId: mainLocationId,
      actorId: operatorActorId,
      reason: 'end of shift count',
      openedAt: '2026-08-14T08:00:00.000Z',
      lines: [{ skuId: beerSkuId, countedQuantityBase: '90' }],
    });

    const first = await counts.close('count-001', {
      actorId: operatorActorId,
      reason: 'physical variance',
      closedAt: '2026-08-14T08:05:00.000Z',
    });
    const second = await counts.close('count-001', {
      actorId: operatorActorId,
      reason: 'retry same close',
      closedAt: '2026-08-14T08:06:00.000Z',
    });

    const movements = await database.query<{ movement_type: string; quantity_delta: string }>(
      `SELECT movement_type, quantity_delta::text
       FROM edge_inventory_ledger
       WHERE event_id = $1 AND inventory_location_id = $2 AND sku_id = $3
       ORDER BY created_at`,
      [inventoryEventId, mainLocationId, beerSkuId],
    );
    expect(first.lines[0]).toMatchObject({
      countedQuantityBase: '90',
      expectedQuantityBase: '100',
      varianceBase: '-10',
    });
    expect(second.state).toBe('CLOSED');
    expect(movements).toEqual([
      { movement_type: 'RECEIPT', quantity_delta: '100' },
      { movement_type: 'COUNT_ADJUSTMENT', quantity_delta: '-10' },
    ]);
  });

  it('quarantines missing inventory mapping without partial depletion', async () => {
    const sale = closedSale({
      eventInstanceId: 'sale-no-map-003',
      salesLocationId: 'unknown-bar',
      lines: [{ skuId: beerSkuId, quantity: 1 }],
    });
    await sales.consume([sale]);

    const movementCount = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM edge_inventory_ledger
       WHERE source_event_instance_id = $1`,
      [sale.eventInstanceId],
    );
    const exceptions = await database.query<{ exception_type: string }>(
      `SELECT exception_type FROM edge_inventory_exceptions
       WHERE source_event_instance_id = $1`,
      [sale.eventInstanceId],
    );
    expect(movementCount[0]!.count).toBe('0');
    expect(exceptions.map((row) => row.exception_type)).toContain(
      'MISSING_SALES_INVENTORY_MAPPING',
    );
  });
  it('serializes identical count creation and rejects changed quantities under the same ID', async () => {
    const input = {
      id: 'count-create-race-002',
      eventId: inventoryEventId,
      inventoryLocationId: mainLocationId,
      actorId: operatorActorId,
      reason: 'cycle count',
      openedAt: '2026-08-14T08:00:00.000Z',
      lines: [{ skuId: beerSkuId, countedQuantityBase: '12' }],
    };

    const [first, second] = await Promise.all([counts.create(input), counts.create(input)]);
    expect(first.id).toBe(input.id);
    expect(second.id).toBe(input.id);

    const rows = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM edge_stock_counts WHERE id = $1',
      [input.id],
    );
    expect(rows[0]!.count).toBe('1');

    await expect(
      counts.create({
        ...input,
        lines: [{ skuId: beerSkuId, countedQuantityBase: '13' }],
      }),
    ).rejects.toThrow(/reused with different content/);

    await expect(
      counts.create({
        ...input,
        id: 'count-duplicate-lines-003',
        lines: [
          { skuId: beerSkuId, countedQuantityBase: '6' },
          { skuId: beerSkuId, countedQuantityBase: '6' },
        ],
      }),
    ).rejects.toThrow(/must not repeat a SKU/);
  });
});
