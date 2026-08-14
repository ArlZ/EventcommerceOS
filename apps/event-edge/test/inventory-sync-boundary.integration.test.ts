import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { EdgeDatabaseService } from '../src/database/database.service';
import { InventoryConfigurationService } from '../src/inventory/inventory-configuration.service';
import { InventoryLedgerService } from '../src/inventory/inventory-ledger.service';
import {
  beerSkuId,
  closedSale,
  installInventoryFixture,
  inventoryEventId,
  mainLocationId,
  receipt,
  resetInventory,
} from './inventory-fixture';
import { posDeviceHeaders, provisionPosDevice } from './pos-device-auth-testkit';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration('sync and inventory acceptance boundary', () => {
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
    await database.query(
      `TRUNCATE edge_cloud_outbox, edge_processed_device_events,
       edge_device_watermarks, edge_reconciliation_exceptions,edge_pos_device_audit,edge_pos_devices`,
    );
    await resetInventory(database);
    await installInventoryFixture(configuration);
    await receipt(ledger, mainLocationId, beerSkuId, 100n, 'sync-boundary-main');
    await provisionPosDevice(database, 'device-inventory-test', { eventId: inventoryEventId });
  });

  afterAll(async () => {
    await app.close();
    delete process.env.EDGE_FORWARDER_DISABLED;
  });

  it('does not apply inventory from an event instance conflict rejected by sync', async () => {
    const sale = closedSale({
      eventInstanceId: 'sync-boundary-sale-401',
      lines: [{ skuId: beerSkuId, quantity: 2 }],
    });

    const accepted = await request(app.getHttpServer())
      .post('/sync/device-events')
      .set(posDeviceHeaders(sale.deviceId))
      .send({ deviceId: sale.deviceId, events: [sale] })
      .expect(201);
    expect(accepted.body.receipts[0].status).toBe('ACCEPTED');

    const conflicting = {
      ...sale,
      payload: {
        ...sale.payload,
        lines: [
          { ...((sale.payload.lines as Array<Record<string, unknown>>)[0] ?? {}), quantity: 50 },
        ],
      },
    };
    const rejected = await request(app.getHttpServer())
      .post('/sync/device-events')
      .set(posDeviceHeaders(conflicting.deviceId))
      .send({ deviceId: conflicting.deviceId, events: [conflicting] })
      .expect(201);
    expect(rejected.body.receipts[0].status).toBe('CONFLICT');

    const movement = await database.query<{ count: string; quantity: string }>(
      `SELECT count(*)::text AS count, SUM(quantity_delta)::text AS quantity
       FROM edge_inventory_ledger
       WHERE source_event_instance_id = $1 AND movement_type = 'SALE'`,
      [sale.eventInstanceId],
    );
    const stock = await database.query<{ on_hand: string }>(
      `SELECT on_hand::text FROM edge_inventory_stock_projection
       WHERE inventory_location_id = $1 AND sku_id = $2`,
      [mainLocationId, beerSkuId],
    );
    expect(movement[0]).toEqual({ count: '1', quantity: '-2' });
    expect(stock[0]!.on_hand).toBe('98');
  });
});
