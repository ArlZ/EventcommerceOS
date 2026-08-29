import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import type { EdgeCloudBatch, SyncEventEnvelope } from '@event-commerce/contracts';
import { AppModule } from '../src/app.module';
import { EdgeDatabaseService } from '../src/database/database.service';
import { CloudForwarderService } from '../src/sync/cloud-forwarder.service';
import { CloudSyncTransport } from '../src/sync/cloud-sync.transport';
import {
  DEFAULT_DEVICE_EVENT_ID,
  posDeviceHeaders,
  provisionPosDevice,
  revokePosDevice,
} from './pos-device-auth-testkit';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

function event(deviceId: string, sequence: number, suffix = ''): SyncEventEnvelope {
  const id = `${deviceId}-${sequence}${suffix}`;
  return {
    schemaVersion: 1,
    eventInstanceId: `instance-${id}`,
    eventId: `event-${id}`,
    eventType: sequence === 3 ? 'ORDER_CLOSED_CASH' : 'ORDER_CHANGED',
    aggregateType: 'ORDER',
    aggregateId: `order-${deviceId}`,
    eventVersion: 1,
    deviceId,
    sequence,
    occurredAt: new Date(1_780_000_000_000 + sequence * 1000).toISOString(),
    idempotencyKey: `idem-${id}`,
    payload: {
      orderId: `order-${deviceId}`,
      eventId: DEFAULT_DEVICE_EVENT_ID,
      state: sequence === 3 ? 'CLOSED' : 'OPEN',
      totalMinor: sequence * 10_000,
      currency: 'KES',
    },
  };
}

describeIntegration('device to edge synchronization', () => {
  let app: INestApplication;
  let database: EdgeDatabaseService;
  let forwarder: CloudForwarderService;
  let cloudAvailable = false;
  const sentBatches: EdgeCloudBatch[] = [];
  const transport: CloudSyncTransport = {
    async send(batch) {
      sentBatches.push(batch);
      if (!cloudAvailable) throw new Error('simulated cloud outage');
      return {
        acceptedEventInstanceIds: batch.events.map((item) => item.eventInstanceId),
        duplicateEventInstanceIds: [],
        conflictEventInstanceIds: [],
        serverTime: new Date().toISOString(),
      };
    },
  };

  beforeAll(async () => {
    process.env.EDGE_FORWARDER_DISABLED = 'true';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CloudSyncTransport)
      .useValue(transport)
      .compile();
    app = moduleRef.createNestApplication();
    database = moduleRef.get(EdgeDatabaseService);
    forwarder = moduleRef.get(CloudForwarderService);
    await app.init();
  });

  beforeEach(async () => {
    cloudAvailable = false;
    sentBatches.length = 0;
    await database.query(
      `TRUNCATE edge_payment_attempt_cache,edge_cloud_outbox,edge_processed_device_events,
                edge_device_watermarks,edge_reconciliation_exceptions,
                edge_pos_device_audit,edge_pos_devices`,
    );
  });

  afterAll(async () => {
    await app.close();
    delete process.env.EDGE_FORWARDER_DISABLED;
  });

  it('syncs provisioned POS devices before any sales activity', async () => {
    cloudAvailable = true;
    await provisionPosDevice(database, 'device-roster-active', {
      salesLocationId: 'bar-roster',
      registerId: 'Till 01',
    });
    await provisionPosDevice(database, 'device-roster-revoked', {
      salesLocationId: 'bar-roster',
      registerId: 'Till 02',
    });
    await revokePosDevice(database, 'device-roster-revoked');

    const result = await forwarder.syncPosDeviceRosterOnce(true);

    expect(result.sent).toBe(2);
    expect(sentBatches).toHaveLength(1);
    expect(sentBatches[0]).toMatchObject({
      edgeId: 'edge-local',
      events: [],
      deviceStatuses: [],
      posDevices: [
        {
          deviceId: 'device-roster-active',
          eventId: DEFAULT_DEVICE_EVENT_ID,
          salesLocationId: 'bar-roster',
          registerId: 'Till 01',
          status: 'ACTIVE',
        },
        {
          deviceId: 'device-roster-revoked',
          eventId: DEFAULT_DEVICE_EVENT_ID,
          salesLocationId: 'bar-roster',
          registerId: 'Till 02',
          status: 'REVOKED',
        },
      ],
    });
  });

  it('replays a persisted event twenty times after a lost acknowledgement with one durable effect', async () => {
    const firstEvent = event('device-replay', 1);
    await provisionPosDevice(database, firstEvent.deviceId);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await request(app.getHttpServer())
        .post('/sync/device-events')
        .set(posDeviceHeaders(firstEvent.deviceId))
        .send({ deviceId: firstEvent.deviceId, events: [firstEvent] })
        .expect(201);
      expect(response.body.acceptedThroughSequence).toBe(1);
      expect(response.body.receipts[0].status).toBe(attempt === 0 ? 'ACCEPTED' : 'DUPLICATE');
    }
    const processed = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM edge_processed_device_events',
    );
    const queued = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM edge_cloud_outbox',
    );
    expect(processed[0]!.count).toBe('1');
    expect(queued[0]!.count).toBe('1');
  });

  it('accepts out-of-order arrival but advances cleanup watermark only after gaps close', async () => {
    const second = event('device-gap', 2);
    const first = event('device-gap', 1);
    await provisionPosDevice(database, second.deviceId);
    const early = await request(app.getHttpServer())
      .post('/sync/device-events')
      .set(posDeviceHeaders(second.deviceId))
      .send({ deviceId: second.deviceId, events: [second] })
      .expect(201);
    expect(early.body.acceptedThroughSequence).toBe(0);
    const filled = await request(app.getHttpServer())
      .post('/sync/device-events')
      .set(posDeviceHeaders(first.deviceId))
      .send({ deviceId: first.deviceId, events: [first] })
      .expect(201);
    expect(filled.body.acceptedThroughSequence).toBe(2);
  });

  it('keeps accepting device events during cloud outage and drains the durable backlog after recovery', async () => {
    const events = [
      event('device-offline-cloud', 1),
      event('device-offline-cloud', 2),
      event('device-offline-cloud', 3),
    ];
    await provisionPosDevice(database, 'device-offline-cloud');
    await request(app.getHttpServer())
      .post('/sync/device-events')
      .set(posDeviceHeaders('device-offline-cloud'))
      .send({ deviceId: 'device-offline-cloud', events })
      .expect(201);
    expect(await forwarder.backlogCount()).toBe(3);

    const failed = await forwarder.drainOnce();
    expect(failed.sent).toBe(0);
    expect(failed.backlog).toBe(3);

    await database.query(
      'UPDATE edge_cloud_outbox SET next_attempt_at = now() WHERE delivered_at IS NULL',
    );
    cloudAvailable = true;
    const drained = await forwarder.drainOnce();
    expect(drained.sent).toBe(3);
    expect(drained.backlog).toBe(0);
    expect(sentBatches).toHaveLength(2);
  });

  it('creates a reconciliation exception when a device sequence is reused', async () => {
    const original = event('device-conflict', 1);
    const conflicting = { ...event('device-conflict', 1, '-other'), sequence: 1 };
    await provisionPosDevice(database, original.deviceId);
    await request(app.getHttpServer())
      .post('/sync/device-events')
      .set(posDeviceHeaders(original.deviceId))
      .send({ deviceId: original.deviceId, events: [original] })
      .expect(201);
    const result = await request(app.getHttpServer())
      .post('/sync/device-events')
      .set(posDeviceHeaders(conflicting.deviceId))
      .send({ deviceId: conflicting.deviceId, events: [conflicting] })
      .expect(201);
    expect(result.body.receipts[0].status).toBe('CONFLICT');
    const exceptions = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM edge_reconciliation_exceptions',
    );
    expect(exceptions[0]!.count).toBe('1');
  });

  it('ingests multiple devices concurrently with independent monotonic watermarks', async () => {
    const deviceIds = Array.from({ length: 10 }, (_, index) => `sim-device-${index + 1}`);
    await Promise.all(deviceIds.map((deviceId) => provisionPosDevice(database, deviceId)));
    await Promise.all(
      deviceIds.map((deviceId) =>
        request(app.getHttpServer())
          .post('/sync/device-events')
          .set(posDeviceHeaders(deviceId))
          .send({
            deviceId,
            events: Array.from({ length: 10 }, (_, index) => event(deviceId, index + 1)),
          })
          .expect(201),
      ),
    );
    const processed = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM edge_processed_device_events',
    );
    const watermarks = await database.query<{ accepted_through_sequence: string }>(
      'SELECT accepted_through_sequence::text FROM edge_device_watermarks ORDER BY device_id',
    );
    expect(processed[0]!.count).toBe('100');
    expect(watermarks).toHaveLength(10);
    expect(watermarks.map((row) => row.accepted_through_sequence)).toEqual(Array(10).fill('10'));
  });
});
