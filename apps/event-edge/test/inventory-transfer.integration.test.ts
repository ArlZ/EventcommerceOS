import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { EdgeDatabaseService } from '../src/database/database.service';
import { InventoryConfigurationService } from '../src/inventory/inventory-configuration.service';
import { InventoryLedgerService } from '../src/inventory/inventory-ledger.service';
import { InventorySaleConsumerService } from '../src/inventory/inventory-sale-consumer.service';
import { InventoryTransferService } from '../src/inventory/inventory-transfer.service';
import {
  beerSkuId,
  closedSale,
  installInventoryFixture,
  inventoryEventId,
  mainLocationId,
  operatorActorId,
  receipt,
  resetInventory,
  warehouseLocationId,
} from './inventory-fixture';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration('inventory transfer custody', () => {
  let app: INestApplication;
  let database: EdgeDatabaseService;
  let configuration: InventoryConfigurationService;
  let ledger: InventoryLedgerService;
  let sales: InventorySaleConsumerService;
  let transfers: InventoryTransferService;

  beforeAll(async () => {
    process.env.EDGE_FORWARDER_DISABLED = 'true';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    database = moduleRef.get(EdgeDatabaseService);
    configuration = moduleRef.get(InventoryConfigurationService);
    ledger = moduleRef.get(InventoryLedgerService);
    sales = moduleRef.get(InventorySaleConsumerService);
    transfers = moduleRef.get(InventoryTransferService);
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

  it('moves custody on dispatch and supports idempotent partial receipt before final receipt', async () => {
    await receipt(ledger, warehouseLocationId, beerSkuId, 200n, 'transfer-source');
    await transfers.create({
      id: 'transfer-001',
      eventId: inventoryEventId,
      sourceLocationId: warehouseLocationId,
      destinationLocationId: mainLocationId,
      actorId: operatorActorId,
      reason: 'replenish main bar',
      requestedAt: '2026-08-14T08:00:00.000Z',
      idempotencyKey: 'transfer-create-001',
      lines: [{ skuId: beerSkuId, requestedQuantityBase: '100' }],
    });
    await transfers.assign('transfer-001', {
      actorId: operatorActorId,
      assignedActorId: 'runner-1',
      occurredAt: '2026-08-14T08:01:00.000Z',
    });
    await transfers.startPicking('transfer-001', {
      actorId: operatorActorId,
      occurredAt: '2026-08-14T08:02:00.000Z',
    });
    const dispatched = await transfers.dispatch('transfer-001', {
      actorId: operatorActorId,
      occurredAt: '2026-08-14T08:03:00.000Z',
      quantities: [{ skuId: beerSkuId, quantityBase: '100' }],
    });
    expect(dispatched.state).toBe('IN_TRANSIT');

    const partial = await transfers.receive('transfer-001', {
      actorId: operatorActorId,
      receivedAt: '2026-08-14T08:04:00.000Z',
      idempotencyKey: 'receipt-partial-001',
      quantities: [{ skuId: beerSkuId, quantityBase: '30' }],
    });
    const partialRetry = await transfers.receive('transfer-001', {
      actorId: operatorActorId,
      receivedAt: '2026-08-14T08:04:00.000Z',
      idempotencyKey: 'receipt-partial-001',
      quantities: [{ skuId: beerSkuId, quantityBase: '30' }],
    });
    expect(partial.state).toBe('IN_TRANSIT');
    expect(partialRetry.state).toBe('IN_TRANSIT');

    const completed = await transfers.receive('transfer-001', {
      actorId: operatorActorId,
      receivedAt: '2026-08-14T08:05:00.000Z',
      idempotencyKey: 'receipt-final-001',
      quantities: [{ skuId: beerSkuId, quantityBase: '70' }],
    });
    expect(completed.state).toBe('RECEIVED');

    const stock = await database.query<{
      inventory_location_id: string;
      on_hand: string;
    }>(
      `SELECT inventory_location_id, on_hand::text
       FROM edge_inventory_stock_projection
       WHERE event_id = $1 AND sku_id = $2
       ORDER BY inventory_location_id`,
      [inventoryEventId, beerSkuId],
    );
    expect(stock).toEqual([
      { inventory_location_id: mainLocationId, on_hand: '100' },
      { inventory_location_id: warehouseLocationId, on_hand: '100' },
    ]);

    const receiptMovements = await database.query<{ count: string; quantity: string }>(
      `SELECT count(*)::text AS count, SUM(quantity_delta)::text AS quantity
       FROM edge_inventory_ledger
       WHERE source_id = 'transfer-001' AND movement_type = 'TRANSFER_IN'`,
    );
    expect(receiptMovements[0]).toEqual({ count: '2', quantity: '100' });
  });

  it('rejects cancellation once stock is in transit', async () => {
    await receipt(ledger, warehouseLocationId, beerSkuId, 100n, 'cancel-source');
    await transfers.create({
      id: 'transfer-cancel-001',
      eventId: inventoryEventId,
      sourceLocationId: warehouseLocationId,
      destinationLocationId: mainLocationId,
      actorId: operatorActorId,
      reason: 'replenish main bar',
      requestedAt: '2026-08-14T08:00:00.000Z',
      idempotencyKey: 'transfer-cancel-create-001',
      lines: [{ skuId: beerSkuId, requestedQuantityBase: '50' }],
    });
    await transfers.assign('transfer-cancel-001', {
      actorId: operatorActorId,
      assignedActorId: 'runner-2',
      occurredAt: '2026-08-14T08:01:00.000Z',
    });
    await transfers.startPicking('transfer-cancel-001', {
      actorId: operatorActorId,
      occurredAt: '2026-08-14T08:02:00.000Z',
    });
    await transfers.dispatch('transfer-cancel-001', {
      actorId: operatorActorId,
      occurredAt: '2026-08-14T08:03:00.000Z',
      quantities: [{ skuId: beerSkuId, quantityBase: '50' }],
    });

    await expect(
      transfers.cancel('transfer-cancel-001', {
        actorId: operatorActorId,
        reason: 'too late',
        occurredAt: '2026-08-14T08:04:00.000Z',
      }),
    ).rejects.toThrow(/invalid stock transfer transition/);
  });

  it('serializes a sale racing a transfer dispatch without losing either committed movement', async () => {
    await receipt(ledger, warehouseLocationId, beerSkuId, 100n, 'race-source');
    await transfers.create({
      id: 'transfer-race-001',
      eventId: inventoryEventId,
      sourceLocationId: warehouseLocationId,
      destinationLocationId: mainLocationId,
      actorId: operatorActorId,
      reason: 'race test',
      requestedAt: '2026-08-14T08:00:00.000Z',
      idempotencyKey: 'transfer-race-create-001',
      lines: [{ skuId: beerSkuId, requestedQuantityBase: '80' }],
    });
    await transfers.assign('transfer-race-001', {
      actorId: operatorActorId,
      assignedActorId: 'runner-race',
      occurredAt: '2026-08-14T08:01:00.000Z',
    });
    await transfers.startPicking('transfer-race-001', {
      actorId: operatorActorId,
      occurredAt: '2026-08-14T08:02:00.000Z',
    });

    const sale = closedSale({
      eventInstanceId: 'race-sale-004',
      salesLocationId: 'warehouse-sales',
      occurredAt: '2026-08-14T08:03:00.000Z',
      lines: [{ skuId: beerSkuId, quantity: 60 }],
    });
    const [saleResult, dispatchResult] = await Promise.allSettled([
      sales.consume([sale]),
      transfers.dispatch('transfer-race-001', {
        actorId: operatorActorId,
        occurredAt: '2026-08-14T08:03:00.000Z',
        quantities: [{ skuId: beerSkuId, quantityBase: '80' }],
      }),
    ]);

    expect(saleResult.status).toBe('fulfilled');
    const transferOut = await database.query<{ count: string; quantity: string }>(
      `SELECT count(*)::text AS count, COALESCE(SUM(quantity_delta), 0)::text AS quantity
       FROM edge_inventory_ledger
       WHERE source_id = 'transfer-race-001' AND movement_type = 'TRANSFER_OUT'`,
    );
    const saleRows = await database.query<{ count: string; quantity: string }>(
      `SELECT count(*)::text AS count, COALESCE(SUM(quantity_delta), 0)::text AS quantity
       FROM edge_inventory_ledger
       WHERE source_event_instance_id = $1`,
      [sale.eventInstanceId],
    );
    const stock = await database.query<{ on_hand: string }>(
      `SELECT on_hand::text FROM edge_inventory_stock_projection
       WHERE event_id = $1 AND inventory_location_id = $2 AND sku_id = $3`,
      [inventoryEventId, warehouseLocationId, beerSkuId],
    );

    expect(saleRows[0]).toEqual({ count: '1', quantity: '-60' });
    if (dispatchResult.status === 'fulfilled') {
      expect(transferOut[0]).toEqual({ count: '1', quantity: '-80' });
      expect(stock[0]!.on_hand).toBe('-40');
    } else {
      expect(dispatchResult.reason).toBeInstanceOf(Error);
      expect(String(dispatchResult.reason)).toMatch(/insufficient source stock/);
      expect(transferOut[0]).toEqual({ count: '0', quantity: '0' });
      expect(stock[0]!.on_hand).toBe('40');
    }
  });
});
