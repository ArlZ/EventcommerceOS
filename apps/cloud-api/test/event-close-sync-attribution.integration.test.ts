import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { EdgeCloudBatch, SyncEventEnvelope } from '@event-commerce/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;
const eventId = '22222222-2222-4222-8222-222222222222';

function orderEvent(
  orderId: string,
  deviceId: string,
  sequence: number,
  eventType: string,
  state: 'OPEN' | 'CLOSED',
): SyncEventEnvelope {
  return {
    schemaVersion: 1,
    eventInstanceId: `${orderId}-${sequence}`,
    eventId: `${orderId}-envelope-${sequence}`,
    eventType,
    aggregateType: 'ORDER',
    aggregateId: orderId,
    eventVersion: 2,
    deviceId,
    sequence,
    occurredAt: new Date(1_780_100_000_000 + sequence * 1000).toISOString(),
    idempotencyKey: `${orderId}-idem-${sequence}`,
    payload: {
      orderId,
      eventId,
      salesLocationId: '55555555-5555-4555-8555-555555555555',
      state,
      totalMinor: 10000,
      currency: 'KES',
      cashierId: 'cashier-a',
      lines: [],
    },
  };
}

function batch(events: SyncEventEnvelope[]): EdgeCloudBatch {
  return { edgeId: 'edge-close-attribution', events, deviceStatuses: [] };
}

describeIntegration('event close order attribution', () => {
  let app: INestApplication;
  let database: DatabaseService;

  beforeAll(async () => {
    process.env.PAYMENT_RECONCILIATION_DISABLED = 'true';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    database = moduleRef.get(DatabaseService);
    await app.init();
  });

  beforeEach(async () => {
    await database.query(
      'TRUNCATE sync_processed_events, sync_order_state, sync_device_state, sync_reconciliation_exceptions',
    );
  });

  afterAll(async () => {
    delete process.env.PAYMENT_RECONCILIATION_DISABLED;
    await app.close();
  });

  it('projects cash/provider close method and cashier from validated close events', async () => {
    const events = [
      orderEvent('order-cash', 'device-cash', 1, 'ORDER_CHANGED', 'OPEN'),
      orderEvent('order-cash', 'device-cash', 2, 'ORDER_CLOSED_CASH', 'CLOSED'),
      orderEvent('order-provider', 'device-provider', 1, 'ORDER_CHANGED', 'OPEN'),
      orderEvent('order-provider', 'device-provider', 2, 'ORDER_CLOSED_PROVIDER', 'CLOSED'),
    ];

    await request(app.getHttpServer()).post('/sync/edge-events').send(batch(events)).expect(201);

    const rows = await database.query<{
      order_id: string;
      close_method: string;
      cashier_id: string;
    }>(
      `SELECT order_id,close_method,cashier_id
       FROM sync_order_state ORDER BY order_id`,
    );
    expect(rows).toEqual([
      { order_id: 'order-cash', close_method: 'CASH', cashier_id: 'cashier-a' },
      { order_id: 'order-provider', close_method: 'PROVIDER', cashier_id: 'cashier-a' },
    ]);
  });
});
