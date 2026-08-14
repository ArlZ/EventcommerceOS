import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { EdgeDatabaseService } from '../src/database/database.service';
import { InventoryAlertService } from '../src/inventory/inventory-alert.service';
import { InventoryConfigurationService } from '../src/inventory/inventory-configuration.service';
import { InventoryLedgerService } from '../src/inventory/inventory-ledger.service';
import { InventoryNotificationService } from '../src/inventory/inventory-notification.service';
import { InventorySaleConsumerService } from '../src/inventory/inventory-sale-consumer.service';
import { InventoryTransferService } from '../src/inventory/inventory-transfer.service';
import {
  beerSkuId,
  closedSale,
  escalationActorId,
  installInventoryFixture,
  inventoryEventId,
  mainLocationId,
  operatorActorId,
  receipt,
  resetInventory,
  warehouseLocationId,
} from './inventory-fixture';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration('inventory alerts and replenishment operations', () => {
  let app: INestApplication;
  let database: EdgeDatabaseService;
  let configuration: InventoryConfigurationService;
  let ledger: InventoryLedgerService;
  let sales: InventorySaleConsumerService;
  let alerts: InventoryAlertService;
  let notifications: InventoryNotificationService;
  let transfers: InventoryTransferService;

  beforeAll(async () => {
    process.env.EDGE_FORWARDER_DISABLED = 'true';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    database = moduleRef.get(EdgeDatabaseService);
    configuration = moduleRef.get(InventoryConfigurationService);
    ledger = moduleRef.get(InventoryLedgerService);
    sales = moduleRef.get(InventorySaleConsumerService);
    alerts = moduleRef.get(InventoryAlertService);
    notifications = moduleRef.get(InventoryNotificationService);
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

  it('distinguishes local risk from event-wide shortage and recommends only source-safe replenishment', async () => {
    await receipt(ledger, mainLocationId, beerSkuId, 50n, 'alert-main');
    await receipt(ledger, warehouseLocationId, beerSkuId, 300n, 'alert-warehouse');
    await sales.consume([
      closedSale({
        eventInstanceId: 'alert-sale-101',
        occurredAt: '2026-08-14T07:55:00.000Z',
        lines: [{ skuId: beerSkuId, quantity: 30 }],
      }),
    ]);

    await alerts.evaluateEvent(inventoryEventId, new Date('2026-08-14T08:00:00.000Z'));
    let active = (await alerts.list(inventoryEventId)).filter(
      (alert) => alert.state !== 'RESOLVED',
    );
    const local = active.find(
      (alert) =>
        alert.inventoryLocationId === mainLocationId && alert.alertType === 'STOCKOUT_RISK',
    );
    expect(local).toBeDefined();
    expect(local!.severity).toBe('URGENT');
    expect(local!.minutesOfCover).toBeGreaterThan(9);
    expect(local!.minutesOfCover).toBeLessThan(10);
    expect(local!.suggestedSourceLocationId).toBe(warehouseLocationId);
    expect(local!.suggestedTransferQuantityBase).toBe('112');
    expect(active.some((alert) => alert.alertType === 'EVENT_WIDE_STOCKOUT_RISK')).toBe(false);

    await ledger.postManual({
      id: 'warehouse-wastage',
      eventId: inventoryEventId,
      inventoryLocationId: warehouseLocationId,
      skuId: beerSkuId,
      movementType: 'WASTAGE',
      quantityDeltaBase: '-150',
      actorId: operatorActorId,
      reason: 'damaged stock discovered',
      occurredAt: '2026-08-14T08:01:00.000Z',
      idempotencyKey: 'warehouse-wastage',
    });
    await alerts.evaluateEvent(inventoryEventId, new Date('2026-08-14T08:02:00.000Z'));
    active = (await alerts.list(inventoryEventId)).filter((alert) => alert.state !== 'RESOLVED');
    expect(active.some((alert) => alert.alertType === 'EVENT_WIDE_STOCKOUT_RISK')).toBe(true);

    await transfers.create({
      id: 'alert-transfer',
      eventId: inventoryEventId,
      sourceLocationId: warehouseLocationId,
      destinationLocationId: mainLocationId,
      actorId: operatorActorId,
      reason: 'respond to local risk',
      requestedAt: '2026-08-14T08:03:00.000Z',
      idempotencyKey: 'alert-transfer-create',
      lines: [{ skuId: beerSkuId, requestedQuantityBase: '50' }],
    });
    await transfers.assign('alert-transfer', {
      actorId: operatorActorId,
      assignedActorId: 'runner-alert',
      occurredAt: '2026-08-14T08:03:10.000Z',
    });
    await transfers.startPicking('alert-transfer', {
      actorId: operatorActorId,
      occurredAt: '2026-08-14T08:03:20.000Z',
    });
    await transfers.dispatch('alert-transfer', {
      actorId: operatorActorId,
      occurredAt: '2026-08-14T08:03:30.000Z',
      quantities: [{ skuId: beerSkuId, quantityBase: '50' }],
    });

    await alerts.evaluateEvent(inventoryEventId, new Date('2026-08-14T08:04:00.000Z'));
    active = (await alerts.list(inventoryEventId)).filter((alert) => alert.state !== 'RESOLVED');
    const updatedLocal = active.find(
      (alert) =>
        alert.inventoryLocationId === mainLocationId && alert.alertType === 'STOCKOUT_RISK',
    );
    expect(updatedLocal).toBeDefined();
    expect(BigInt(updatedLocal!.suggestedTransferQuantityBase ?? '0')).toBeLessThanOrEqual(20n);
  });

  it('audits alert workflow, escalates overdue ownership and isolates notification failure', async () => {
    await receipt(ledger, mainLocationId, beerSkuId, 30n, 'workflow-main');
    await sales.consume([
      closedSale({
        eventInstanceId: 'workflow-sale-102',
        occurredAt: '2026-08-14T07:55:00.000Z',
        lines: [{ skuId: beerSkuId, quantity: 20 }],
      }),
    ]);
    await alerts.evaluateEvent(inventoryEventId, new Date('2026-08-14T08:00:00.000Z'));

    const active = (await alerts.list(inventoryEventId)).filter(
      (alert) => alert.state !== 'RESOLVED',
    );
    const local = active.find((alert) => alert.inventoryLocationId === mainLocationId)!;
    const eventWide = active.find((alert) => alert.alertType === 'EVENT_WIDE_STOCKOUT_RISK')!;
    expect(local).toBeDefined();
    expect(eventWide).toBeDefined();

    const acknowledged = await alerts.transition(local.id, {
      actorId: operatorActorId,
      toState: 'ACKNOWLEDGED',
      reason: 'controller acknowledged',
      occurredAt: '2026-08-14T08:01:00.000Z',
    });
    const assigned = await alerts.transition(local.id, {
      actorId: operatorActorId,
      toState: 'ASSIGNED',
      assignedActorId: 'runner-alert',
      reason: 'runner dispatched',
      occurredAt: '2026-08-14T08:02:00.000Z',
    });
    expect(acknowledged.state).toBe('ACKNOWLEDGED');
    expect(assigned.state).toBe('ASSIGNED');

    const escalated = await alerts.runEscalations(
      inventoryEventId,
      new Date('2026-08-14T08:10:00.000Z'),
    );
    const escalatedAgain = await alerts.runEscalations(
      inventoryEventId,
      new Date('2026-08-14T08:10:00.000Z'),
    );
    expect(escalated).toBeGreaterThanOrEqual(1);
    expect(escalatedAgain).toBe(0);

    const escalationMessages = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM edge_inventory_notification_outbox
       WHERE recipient_actor_id = $1 AND payload->>'reason' = 'escalation'`,
      [escalationActorId],
    );
    expect(Number(escalationMessages[0]!.count)).toBeGreaterThanOrEqual(1);

    await database.query(
      `INSERT INTO edge_inventory_notification_outbox(
         id, alert_id, channel, recipient_actor_id, payload, next_attempt_at
       ) VALUES ('sms-failure-test',$1,'SMS',$2,'{"kind":"external-test"}'::jsonb,now() - interval '1 minute')`,
      [eventWide.id, escalationActorId],
    );
    const ledgerBefore = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM edge_inventory_ledger',
    );
    const delivery = await notifications.drainOnce(100);
    const ledgerAfter = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM edge_inventory_ledger',
    );
    const failedSms = await database.query<{ attempts: number; delivered_at: Date | null }>(
      `SELECT attempts, delivered_at FROM edge_inventory_notification_outbox
       WHERE id = 'sms-failure-test'`,
    );

    expect(delivery.failed).toBe(1);
    expect(failedSms[0]!.attempts).toBe(1);
    expect(failedSms[0]!.delivered_at).toBeNull();
    expect(ledgerAfter[0]!.count).toBe(ledgerBefore[0]!.count);

    const history = await database.query<{ to_state: string }>(
      `SELECT to_state FROM edge_inventory_alert_history
       WHERE alert_id = $1 ORDER BY occurred_at`,
      [local.id],
    );
    expect(history.map((row) => row.to_state)).toEqual(['OPEN', 'ACKNOWLEDGED', 'ASSIGNED']);
  });
});
