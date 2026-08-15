import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { EdgeCloudBatch, SyncEventEnvelope } from '@event-commerce/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { provisionSyncEdge } from './sync-auth-testkit';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;
const eventId = '22222222-2222-4222-8222-222222222222';
const otherEventId = '22222222-2222-4222-8222-333333333333';
const locationId = '55555555-5555-4555-8555-555555555555';
const skuId = '88888888-8888-4888-8888-888888888888';
const edgeId = 'projection-edge';

function orderEvent(sequence: number, businessEventId = eventId): SyncEventEnvelope {
  return {
    schemaVersion: 1,
    eventInstanceId: `projection-instance-${sequence}`,
    eventId: `projection-envelope-${sequence}`,
    eventType: sequence === 1 ? 'ORDER_CHANGED' : 'ORDER_CLOSED_CASH',
    aggregateType: 'ORDER',
    aggregateId: 'projection-order',
    eventVersion: 2,
    deviceId: 'projection-device',
    sequence,
    occurredAt: new Date(1_780_100_000_000 + sequence * 1000).toISOString(),
    idempotencyKey: `projection-idem-${sequence}`,
    payload: {
      orderId: 'projection-order',
      eventId: businessEventId,
      salesLocationId: locationId,
      state: sequence === 1 ? 'OPEN' : 'CLOSED',
      totalMinor: sequence * 10_000,
      currency: 'KES',
      lines: [{ menuItemId: 'menu-item-1', skuId, quantity: 2, unitPriceMinor: 5_000 }],
    },
  };
}

function batch(event: SyncEventEnvelope): EdgeCloudBatch {
  return {
    edgeId,
    events: [event],
    deviceStatuses: [
      {
        deviceId: event.deviceId,
        lastSeenAt: event.occurredAt,
        lastSequenceSeen: event.sequence,
        edgeAcceptedThroughSequence: event.sequence,
        edgeBacklogCount: 0,
        lastCloudDeliveryAt: event.occurredAt,
      },
    ],
  };
}

describeIntegration('validated command centre order projection', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let authHeaders: Record<string, string>;

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
    authHeaders = (await provisionSyncEdge(database, { edgeId, eventIds: [eventId, otherEventId] }))
      .headers;
  });

  afterAll(async () => {
    delete process.env.PAYMENT_RECONCILIATION_DISABLED;
    await app.close();
  });

  it('stores event, location and line dimensions only after order validation', async () => {
    await request(app.getHttpServer())
      .post('/sync/edge-events')
      .set(authHeaders)
      .send(batch(orderEvent(1)))
      .expect(201);
    await request(app.getHttpServer())
      .post('/sync/edge-events')
      .set(authHeaders)
      .send(batch(orderEvent(2)))
      .expect(201);

    const rows = await database.query<{
      event_id: string;
      sales_location_id: string;
      lines: Array<{ skuId: string; quantity: number; unitPriceMinor: number }>;
      state: string;
      total_minor: string;
    }>(
      `SELECT event_id,sales_location_id,lines,state,total_minor::text
       FROM sync_order_state WHERE order_id='projection-order'`,
    );
    expect(rows[0]).toMatchObject({
      event_id: eventId,
      sales_location_id: locationId,
      state: 'CLOSED',
      total_minor: '20000',
    });
    expect(rows[0]?.lines).toEqual([
      { menuItemId: 'menu-item-1', skuId, quantity: 2, unitPriceMinor: 5000 },
    ]);
  });

  it('rejects a higher sequence trying to move an order into another business event', async () => {
    await request(app.getHttpServer())
      .post('/sync/edge-events')
      .set(authHeaders)
      .send(batch(orderEvent(1)))
      .expect(201);
    const response = await request(app.getHttpServer())
      .post('/sync/edge-events')
      .set(authHeaders)
      .send(batch(orderEvent(2, otherEventId)))
      .expect(201);
    expect(response.body.conflictEventInstanceIds).toEqual(['projection-instance-2']);

    const rows = await database.query<{ event_id: string; state: string }>(
      `SELECT event_id,state FROM sync_order_state WHERE order_id='projection-order'`,
    );
    expect(rows[0]).toEqual({ event_id: eventId, state: 'OPEN' });
  });
});
