import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { EdgeDatabaseService } from '../src/database/database.service';
import {
  DEFAULT_DEVICE_EVENT_ID,
  posDeviceHeaders,
  provisionPosDevice,
} from './pos-device-auth-testkit';

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
      `TRUNCATE edge_cloud_outbox, edge_processed_device_events, edge_device_watermarks,
                edge_reconciliation_exceptions,edge_pos_device_audit,edge_pos_devices`,
    );
    await provisionPosDevice(database, 'edge-conflict-device');
  });

  afterAll(async () => {
    await app.close();
    delete process.env.EDGE_FORWARDER_DISABLED;
  });

  it('keeps a device blocked at an unresolved sequence fork until reconciliation resolves it', async () => {
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
      payload: {
        orderId: 'edge-order',
        eventId: DEFAULT_DEVICE_EVENT_ID,
        state: 'OPEN',
        totalMinor: 10_000,
        currency: 'KES',
      },
    };
    await request(app.getHttpServer())
      .post('/sync/device-events')
      .set(posDeviceHeaders(original.deviceId))
      .send({ deviceId: original.deviceId, events: [original] })
      .expect(201);

    const conflict = {
      ...original,
      eventInstanceId: 'edge-conflicting-instance',
      eventId: 'edge-conflicting-event',
      idempotencyKey: 'edge-conflicting-idem',
      payload: { ...original.payload, totalMinor: 20_000 },
    };
    const conflictResponse = await request(app.getHttpServer())
      .post('/sync/device-events')
      .set(posDeviceHeaders(conflict.deviceId))
      .send({ deviceId: conflict.deviceId, events: [conflict] })
      .expect(201);

    expect(conflictResponse.body.receipts[0].status).toBe('CONFLICT');
    expect(conflictResponse.body.acceptedThroughSequence).toBe(0);

    const next = {
      ...original,
      eventInstanceId: 'edge-next-instance',
      eventId: 'edge-next-event',
      sequence: 2,
      occurredAt: '2026-08-13T18:00:01Z',
      idempotencyKey: 'edge-next-idem',
      payload: { ...original.payload, totalMinor: 30_000 },
    };
    const stillBlocked = await request(app.getHttpServer())
      .post('/sync/device-events')
      .set(posDeviceHeaders(next.deviceId))
      .send({ deviceId: next.deviceId, events: [next] })
      .expect(201);

    expect(stillBlocked.body.acceptedThroughSequence).toBe(0);
    const persisted = await database.query<{ accepted_through_sequence: string }>(
      `SELECT accepted_through_sequence::text
       FROM edge_device_watermarks
       WHERE device_id = $1`,
      [original.deviceId],
    );
    expect(persisted[0]!.accepted_through_sequence).toBe('0');

    const exceptions = await database.query<{ exception_type: string }>(
      'SELECT exception_type FROM edge_reconciliation_exceptions WHERE resolved_at IS NULL',
    );
    expect(exceptions.map((row) => row.exception_type)).toContain('DEVICE_SEQUENCE_REUSE');

    await database.query(
      'UPDATE edge_reconciliation_exceptions SET resolved_at = now() WHERE device_id = $1',
      [original.deviceId],
    );
    const afterResolution = await request(app.getHttpServer())
      .post('/sync/device-events')
      .set(posDeviceHeaders(next.deviceId))
      .send({ deviceId: next.deviceId, events: [next] })
      .expect(201);

    expect(afterResolution.body.receipts[0].status).toBe('DUPLICATE');
    expect(afterResolution.body.acceptedThroughSequence).toBe(2);
  });
});
