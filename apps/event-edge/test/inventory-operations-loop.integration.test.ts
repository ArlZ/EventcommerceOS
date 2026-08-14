import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { EdgeDatabaseService } from '../src/database/database.service';
import { InventoryAlertService } from '../src/inventory/inventory-alert.service';
import { InventoryConfigurationService } from '../src/inventory/inventory-configuration.service';
import { InventoryLedgerService } from '../src/inventory/inventory-ledger.service';
import { InventoryOperationsLoopService } from '../src/inventory/inventory-operations-loop.service';
import { InventorySaleConsumerService } from '../src/inventory/inventory-sale-consumer.service';
import {
  beerSkuId,
  closedSale,
  escalationActorId,
  installInventoryFixture,
  inventoryEventId,
  mainLocationId,
  receipt,
  resetInventory,
} from './inventory-fixture';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration('inventory periodic operations loop', () => {
  let app: INestApplication;
  let database: EdgeDatabaseService;
  let configuration: InventoryConfigurationService;
  let ledger: InventoryLedgerService;
  let sales: InventorySaleConsumerService;
  let alerts: InventoryAlertService;
  let loop: InventoryOperationsLoopService;

  beforeAll(async () => {
    process.env.EDGE_FORWARDER_DISABLED = 'true';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    database = moduleRef.get(EdgeDatabaseService);
    configuration = moduleRef.get(InventoryConfigurationService);
    ledger = moduleRef.get(InventoryLedgerService);
    sales = moduleRef.get(InventorySaleConsumerService);
    alerts = moduleRef.get(InventoryAlertService);
    loop = moduleRef.get(InventoryOperationsLoopService);
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

  it('refreshes time-dependent alerts and runs escalation without an operator request', async () => {
    await receipt(ledger, mainLocationId, beerSkuId, 30n, 'loop-main');
    await sales.consume([
      closedSale({
        eventInstanceId: 'loop-sale-201',
        occurredAt: '2026-08-14T07:55:00.000Z',
        lines: [{ skuId: beerSkuId, quantity: 20 }],
      }),
    ]);
    await alerts.evaluateEvent(inventoryEventId, new Date('2026-08-14T08:00:00.000Z'));

    const result = await loop.runOnce(new Date('2026-08-14T08:10:00.000Z'));
    expect(result.eventsEvaluated).toBe(1);

    const escalation = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM edge_inventory_notification_outbox
       WHERE recipient_actor_id = $1 AND payload->>'reason' = 'escalation'`,
      [escalationActorId],
    );
    expect(Number(escalation[0]!.count)).toBeGreaterThanOrEqual(1);
  });
});
