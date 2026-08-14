import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration('invalid synced order quarantine', () => {
  let app: INestApplication;
  let database: DatabaseService;

  beforeAll(async () => {
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

  afterAll(async () => app.close());

  it('persists an invalid order event once and acknowledges it as a terminal conflict', async () => {
    const event = {
      schemaVersion: 1,
      eventInstanceId: 'invalid-order-instance',
      eventId: 'invalid-order-event',
      eventType: 'ORDER_CHANGED',
      aggregateType: 'ORDER',
      aggregateId: 'invalid-order',
      eventVersion: 1,
      deviceId: 'device-invalid',
      sequence: 1,
      occurredAt: '2026-08-13T18:00:00Z',
      idempotencyKey: 'invalid-order-idempotency',
      payload: { orderId: 'invalid-order', state: 'BOGUS', totalMinor: 10_000, currency: 'KES' },
    };
    const body = {
      edgeId: 'edge-test',
      events: [event],
      deviceStatuses: [
        {
          deviceId: 'device-invalid',
          lastSeenAt: '2026-08-13T18:00:00Z',
          lastSequenceSeen: 1,
          edgeAcceptedThroughSequence: 1,
          edgeBacklogCount: 1,
          lastCloudDeliveryAt: null,
        },
      ],
    };

    const first = await request(app.getHttpServer())
      .post('/sync/edge-events')
      .send(body)
      .expect(201);
    expect(first.body.conflictEventInstanceIds).toEqual(['invalid-order-instance']);

    const replay = await request(app.getHttpServer())
      .post('/sync/edge-events')
      .send(body)
      .expect(201);
    expect(replay.body.duplicateEventInstanceIds).toEqual(['invalid-order-instance']);

    const processed = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM sync_processed_events',
    );
    const exceptions = await database.query<{ exception_type: string }>(
      'SELECT exception_type FROM sync_reconciliation_exceptions',
    );
    expect(processed[0]!.count).toBe('1');
    expect(exceptions.map((row) => row.exception_type)).toContain('INVALID_ORDER_EVENT');
  });
});
