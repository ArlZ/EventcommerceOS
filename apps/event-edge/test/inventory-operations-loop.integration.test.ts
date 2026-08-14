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

  it('recovers a persisted sale after a crash between sync durability and inventory consumption', async () => {
    await receipt(ledger, mainLocationId, beerSkuId, 100n, 'crash-window-main');
    const sale = closedSale({
      eventInstanceId: 'crash-window-sale-301',
      occurredAt: '2026-08-14T08:00:00.000Z',
      lines: [{ skuId: beerSkuId, quantity: 2 }],
    });

    await database.query(
      `INSERT INTO edge_processed_device_events(
         event_instance_id, event_id, event_type, aggregate_type, aggregate_id,
         event_version, device_id, sequence, occurred_at, idempotency_key, payload, envelope,
         received_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13)`,
      [
        sale.eventInstanceId,
        sale.eventId,
        sale.eventType,
        sale.aggregateType,
        sale.aggregateId,
        sale.eventVersion,
        sale.deviceId,
        sale.sequence,
        sale.occurredAt,
        sale.idempotencyKey,
        JSON.stringify(sale.payload),
        JSON.stringify(sale),
        sale.occurredAt,
      ],
    );

    const before = await database.query<{ processed_at: Date | null }>(
      `SELECT processed_at FROM edge_inventory_sale_inbox
       WHERE source_event_instance_id = $1`,
      [sale.eventInstanceId],
    );
    expect(before[0]!.processed_at).toBeNull();

    const first = await loop.runOnce(new Date('2026-08-14T08:00:10.000Z'));
    const second = await loop.runOnce(new Date('2026-08-14T08:00:20.000Z'));
    expect(first.salesReconciled).toBe(1);
    expect(second.salesReconciled).toBe(0);

    const movement = await database.query<{ count: string; quantity: string }>(
      `SELECT count(*)::text AS count, SUM(quantity_delta)::text AS quantity
       FROM edge_inventory_ledger
       WHERE source_event_instance_id = $1 AND movement_type = 'SALE'`,
      [sale.eventInstanceId],
    );
    const inbox = await database.query<{ processed_at: Date | null; outcome: string | null }>(
      `SELECT processed_at, outcome FROM edge_inventory_sale_inbox
       WHERE source_event_instance_id = $1`,
      [sale.eventInstanceId],
    );
    expect(movement[0]).toEqual({ count: '1', quantity: '-2' });
    expect(inbox[0]!.processed_at).not.toBeNull();
    expect(inbox[0]!.outcome).toBe('APPLIED');
  });
});
