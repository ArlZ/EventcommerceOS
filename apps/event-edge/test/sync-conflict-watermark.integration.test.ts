import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { EdgeDatabaseService } from '../src/database/database.service';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration('device conflict acknowledgement safety', () => {
  let app: INestApplication;
  let database: EdgeDatabaseService;

  beforeAll(async () => {
    process.env.EDGE_FORWARDER_DISABLED = 'true';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    database = moduleRef.get(EdgeDatabaseService);
    await app.init();
  });

  beforeEach(async () => {
    await database.query(
      'TRUNCATE edge_cloud_outbox, edge_processed_device_events, edge_device_watermarks, edge_reconciliation_exceptions',
    );
  });

  afterAll(async () => {
    await app.close();
    delete process.env.EDGE_FORWARDER_DISABLED;
  });

  it('does not acknowledge through a conflicting local sequence', async () => {
    const original = {
      schemaVersion: 1,
      eventInstanceId: 'edge-existing-instance',
      eventId: 'edge-existing-event',
      eventType: 'ORDER_CHANGED',
      aggregateType: 'ORDER',
      aggregateId: 'edge-order',
      eventVersion: 1,
      deviceId: 'edge-conflict-device',
      sequence: 1,
      occurredAt: '2026-08-13T18:00:00Z',
      idempotencyKey: 'edge-existing-idem',
      payload: { orderId: 'edge-order', state: 'OPEN', totalMinor: 10_000, currency: 'KES' },
    };
    await request(app.getHttpServer())
      .post('/sync/device-events')
      .send({ deviceId: original.deviceId, events: [original] })
      .expect(201);

    const conflict = {
      ...original,
      eventInstanceId: 'edge-conflicting-instance',
      eventId: 'edge-conflicting-event',
      idempotencyKey: 'edge-conflicting-idem',
      payload: { ...original.payload, totalMinor: 20_000 },
    };
    const response = await request(app.getHttpServer())
      .post('/sync/device-events')
      .send({ deviceId: conflict.deviceId, events: [conflict] })
      .expect(201);

    expect(response.body.receipts[0].status).toBe('CONFLICT');
    expect(response.body.acceptedThroughSequence).toBe(0);
    const exceptions = await database.query<{ exception_type: string }>(
      'SELECT exception_type FROM edge_reconciliation_exceptions',
    );
    expect(exceptions.map((row) => row.exception_type)).toContain('DEVICE_SEQUENCE_REUSE');
  });
});
