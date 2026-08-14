import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { EdgeDatabaseService } from '../src/database/database.service';
import { InventoryConfigurationService } from '../src/inventory/inventory-configuration.service';
import { InventoryLedgerService } from '../src/inventory/inventory-ledger.service';
import {
  beerSkuId,
  installInventoryFixture,
  inventoryEventId,
  mainLocationId,
  operatorActorId,
  resetInventory,
} from './inventory-fixture';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration('inventory manual movement audit safety', () => {
  let app: INestApplication;
  let database: EdgeDatabaseService;
  let configuration: InventoryConfigurationService;
  let ledger: InventoryLedgerService;

  beforeAll(async () => {
    process.env.EDGE_FORWARDER_DISABLED = 'true';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    database = moduleRef.get(EdgeDatabaseService);
    configuration = moduleRef.get(InventoryConfigurationService);
    ledger = moduleRef.get(InventoryLedgerService);
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

  it('rejects manual attempts to impersonate sale transfer or count workflows', async () => {
    for (const movementType of ['SALE', 'TRANSFER_IN', 'COUNT_ADJUSTMENT'] as const) {
      await expect(
        ledger.postManual({
          id: `manual-${movementType}`,
          eventId: inventoryEventId,
          inventoryLocationId: mainLocationId,
          skuId: beerSkuId,
          movementType,
          quantityDeltaBase: movementType === 'TRANSFER_IN' ? '1' : '-1',
          actorId: operatorActorId,
          reason: 'attempted workflow bypass',
          occurredAt: '2026-08-14T08:00:00.000Z',
          idempotencyKey: `manual-${movementType}`,
        }),
      ).rejects.toThrow(/dedicated inventory workflow/);
    }

    const count = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM edge_inventory_ledger`,
    );
    expect(count[0]!.count).toBe('0');
  });

  it('requires a reversal to exactly negate one prior movement and prevents a second reversal', async () => {
    const original = await ledger.postManual({
      id: 'receipt-to-reverse',
      eventId: inventoryEventId,
      inventoryLocationId: mainLocationId,
      skuId: beerSkuId,
      movementType: 'RECEIPT',
      quantityDeltaBase: '25',
      actorId: operatorActorId,
      reason: 'incorrect receipt',
      occurredAt: '2026-08-14T08:00:00.000Z',
      idempotencyKey: 'receipt-to-reverse',
    });

    await expect(
      ledger.postManual({
        id: 'bad-reversal',
        eventId: inventoryEventId,
        inventoryLocationId: mainLocationId,
        skuId: beerSkuId,
        movementType: 'REVERSAL',
        quantityDeltaBase: '-24',
        actorId: operatorActorId,
        reason: 'wrong reversal amount',
        occurredAt: '2026-08-14T08:01:00.000Z',
        idempotencyKey: 'bad-reversal',
        reversalOfLedgerId: original.id,
      }),
    ).rejects.toThrow(/exactly negate/);

    await ledger.postManual({
      id: 'good-reversal',
      eventId: inventoryEventId,
      inventoryLocationId: mainLocationId,
      skuId: beerSkuId,
      movementType: 'REVERSAL',
      quantityDeltaBase: '-25',
      actorId: operatorActorId,
      reason: 'reverse incorrect receipt',
      occurredAt: '2026-08-14T08:02:00.000Z',
      idempotencyKey: 'good-reversal',
      reversalOfLedgerId: original.id,
    });

    await expect(
      ledger.postManual({
        id: 'second-reversal',
        eventId: inventoryEventId,
        inventoryLocationId: mainLocationId,
        skuId: beerSkuId,
        movementType: 'REVERSAL',
        quantityDeltaBase: '-25',
        actorId: operatorActorId,
        reason: 'duplicate business reversal',
        occurredAt: '2026-08-14T08:03:00.000Z',
        idempotencyKey: 'second-reversal',
        reversalOfLedgerId: original.id,
      }),
    ).rejects.toThrow(/reversal target was reused/);

    const stock = await database.query<{ on_hand: string }>(
      `SELECT on_hand::text FROM edge_inventory_stock_projection
       WHERE event_id = $1 AND inventory_location_id = $2 AND sku_id = $3`,
      [inventoryEventId, mainLocationId, beerSkuId],
    );
    expect(stock[0]!.on_hand).toBe('0');
  });
});
