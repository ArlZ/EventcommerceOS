import 'reflect-metadata';
import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { EdgeDatabaseService } from '../src/database/database.service';
import {
  DEFAULT_DEVICE_EVENT_ID,
  ensureDeviceEvent,
  posDeviceHeaders,
  provisionPosDevice,
  revokePosDevice,
  tokenForDevice,
} from './pos-device-auth-testkit';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;
const deviceId = 'pos-security-device';
const otherEventId = 'event-pos-security-other';

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function syncBody(
  eventId = DEFAULT_DEVICE_EVENT_ID,
  bodyDeviceId = deviceId,
  salesLocationId?: string,
) {
  return {
    deviceId: bodyDeviceId,
    events: [
      {
        schemaVersion: 1,
        eventInstanceId: `security-sync-${eventId}-${bodyDeviceId}-${salesLocationId ?? 'none'}`,
        eventId: `security-envelope-${eventId}-${bodyDeviceId}-${salesLocationId ?? 'none'}`,
        eventType: 'ORDER_CHANGED',
        aggregateType: 'ORDER',
        aggregateId: `security-order-${bodyDeviceId}`,
        eventVersion: 1,
        deviceId: bodyDeviceId,
        sequence: 1,
        occurredAt: '2026-08-14T18:00:00.000Z',
        idempotencyKey: `security-idem-${eventId}-${bodyDeviceId}-${salesLocationId ?? 'none'}`,
        payload: {
          orderId: `security-order-${bodyDeviceId}`,
          eventId,
          ...(salesLocationId === undefined ? {} : { salesLocationId }),
          state: 'OPEN',
          totalMinor: 10000,
          currency: 'KES',
        },
      },
    ],
  };
}

function paymentBody(eventId = DEFAULT_DEVICE_EVENT_ID) {
  return {
    eventId,
    paymentId: 'security-payment',
    paymentAttemptId: 'security-attempt',
    orderId: 'security-order-payment',
    providerId: 'fake',
    idempotencyKey: 'PAYMENT:security-order-payment:primary:security-attempt',
    amountMinor: 15000,
    currency: 'KES',
    accountReference: 'SECURITY-ORDER',
    description: 'Security test',
  };
}

function cloudPaymentView(eventId = DEFAULT_DEVICE_EVENT_ID) {
  return {
    eventId,
    paymentId: 'security-payment',
    paymentAttemptId: 'security-attempt',
    orderId: 'security-order-payment',
    providerId: 'fake',
    amountMinor: 15000,
    currency: 'KES',
    status: 'PENDING',
    providerReference: 'security-provider-ref',
    failureCode: null,
    reconciliationRequired: false,
    createdAt: '2026-08-14T18:00:00.000Z',
    updatedAt: '2026-08-14T18:00:01.000Z',
  };
}

describeIntegration('authenticated POS device to Event Edge boundary', () => {
  let app: INestApplication;
  let database: EdgeDatabaseService;

  beforeAll(async () => {
    process.env.EDGE_FORWARDER_DISABLED = 'true';
    process.env.EDGE_ID = 'edge-pos-auth-test';
    process.env.EDGE_CLOUD_SYNC_TOKEN =
      'test-edge-cloud-sync-token-0123456789-abcdefghijklmnopqrstuvwxyz';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    database = moduleRef.get(EdgeDatabaseService);
    await app.init();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await database.query(
      `TRUNCATE edge_payment_attempt_cache,edge_cloud_outbox,edge_processed_device_events,
                edge_device_watermarks,edge_reconciliation_exceptions,
                edge_pos_device_audit,edge_pos_devices`,
    );
    await ensureDeviceEvent(database, otherEventId);
    await provisionPosDevice(database, deviceId);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env.EDGE_FORWARDER_DISABLED;
    delete process.env.EDGE_ID;
    delete process.env.EDGE_CLOUD_SYNC_TOKEN;
    await app.close();
  });

  it('rejects missing, invalid and mismatched device identity before sync persistence', async () => {
    const body = syncBody();
    await request(app.getHttpServer()).post('/sync/device-events').send(body).expect(401);
    await request(app.getHttpServer())
      .post('/sync/device-events')
      .set(posDeviceHeaders(deviceId, `${tokenForDevice(deviceId)}-wrong`))
      .send(body)
      .expect(401);
    await request(app.getHttpServer())
      .post('/sync/device-events')
      .set(posDeviceHeaders(deviceId))
      .send(syncBody(DEFAULT_DEVICE_EVENT_ID, 'different-device'))
      .expect(401);

    const rows = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM edge_processed_device_events',
    );
    expect(rows[0]!.count).toBe('0');
  });

  it('returns authenticated sync status without requiring a new business event', async () => {
    await request(app.getHttpServer()).get('/sync/device-status').expect(401);

    const initial = await request(app.getHttpServer())
      .get('/sync/device-status')
      .set(posDeviceHeaders(deviceId))
      .expect(200);
    expect(initial.body.deviceId).toBe(deviceId);
    expect(initial.body.acceptedThroughSequence).toBe(0);
    expect(initial.body.edgeBacklogCount).toBe(0);
    expect(initial.body.receipts).toEqual([]);

    await request(app.getHttpServer())
      .post('/sync/device-events')
      .set(posDeviceHeaders(deviceId))
      .send(syncBody())
      .expect(201);

    const afterSync = await request(app.getHttpServer())
      .get('/sync/device-status')
      .set(posDeviceHeaders(deviceId))
      .expect(200);
    expect(afterSync.body.acceptedThroughSequence).toBe(1);
    expect(afterSync.body.edgeBacklogCount).toBe(1);
    expect(afterSync.body.receipts).toEqual([]);
  });

  it('rejects a device event outside the server-side event assignment', async () => {
    await request(app.getHttpServer())
      .post('/sync/device-events')
      .set(posDeviceHeaders(deviceId))
      .send(syncBody(otherEventId))
      .expect(401);

    const rows = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM edge_processed_device_events',
    );
    expect(rows[0]!.count).toBe('0');
  });

  it('requires the exact assigned sales location on order sync', async () => {
    const assignedLocation = 'bar-west';
    await provisionPosDevice(database, deviceId, { salesLocationId: assignedLocation });

    await request(app.getHttpServer())
      .post('/sync/device-events')
      .set(posDeviceHeaders(deviceId))
      .send(syncBody())
      .expect(401);
    await request(app.getHttpServer())
      .post('/sync/device-events')
      .set(posDeviceHeaders(deviceId))
      .send(syncBody(DEFAULT_DEVICE_EVENT_ID, deviceId, 'bar-east'))
      .expect(401);
    await request(app.getHttpServer())
      .post('/sync/device-events')
      .set(posDeviceHeaders(deviceId))
      .send(syncBody(DEFAULT_DEVICE_EVENT_ID, deviceId, assignedLocation))
      .expect(201);
  });

  it('revokes the POS device immediately without deleting its local business history', async () => {
    await revokePosDevice(database, deviceId);
    await request(app.getHttpServer())
      .post('/sync/device-events')
      .set(posDeviceHeaders(deviceId))
      .send(syncBody())
      .expect(401);

    const rows = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM edge_processed_device_events',
    );
    expect(rows[0]!.count).toBe('0');
  });

  it('invalidates the old credential immediately on rotation', async () => {
    const rotated = 'pos-security-rotated-token-0123456789-abcdefghijklmnopqrstuvwxyz';
    await database.query(
      `UPDATE edge_pos_devices
       SET credential_sha256=$2,credential_version=credential_version+1,last_authenticated_at=NULL,updated_at=now()
       WHERE device_id=$1`,
      [deviceId, digest(rotated)],
    );

    await request(app.getHttpServer())
      .post('/sync/device-events')
      .set(posDeviceHeaders(deviceId))
      .send(syncBody())
      .expect(401);
    await request(app.getHttpServer())
      .post('/sync/device-events')
      .set(posDeviceHeaders(deviceId, rotated))
      .send(syncBody())
      .expect(201);
  });

  it('blocks wrong-event payment initiation before Cloud or Edge payment business effect', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await request(app.getHttpServer())
      .post('/payments/initiate')
      .set(posDeviceHeaders(deviceId))
      .send(paymentBody(otherEventId))
      .expect(401);

    const cache = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM edge_payment_attempt_cache',
    );
    expect(cache[0]!.count).toBe('0');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows an assigned active device to initiate payment and records POS ownership at Edge', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(cloudPaymentView()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app.getHttpServer())
      .post('/payments/initiate')
      .set(posDeviceHeaders(deviceId))
      .send(paymentBody())
      .expect(201);
    expect(response.body.status).toBe('PENDING');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const cache = await database.query<{ event_id: string; device_id: string }>(
      'SELECT event_id,device_id FROM edge_payment_attempt_cache WHERE payment_attempt_id=$1',
      ['security-attempt'],
    );
    expect(cache[0]).toEqual({ event_id: DEFAULT_DEVICE_EVENT_ID, device_id: deviceId });
  });

  it('prevents a device from reconciling another event payment attempt', async () => {
    await database.query(
      `INSERT INTO edge_payment_attempt_cache(
         payment_attempt_id,payment_id,event_id,order_id,provider_id,idempotency_key,
         amount_minor,currency,status
       ) VALUES ('other-attempt','other-payment',$1,'other-order','fake','other-idem',10000,'KES','UNKNOWN')`,
      [otherEventId],
    );
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await request(app.getHttpServer())
      .post('/payments/attempts/other-attempt/reconcile')
      .set(posDeviceHeaders(deviceId))
      .send({})
      .expect(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prevents another POS in the same event from reading or reconciling owned payment history', async () => {
    const peerDevice = 'pos-security-peer';
    await provisionPosDevice(database, peerDevice);
    await database.query(
      `INSERT INTO edge_payment_attempt_cache(
         payment_attempt_id,payment_id,event_id,order_id,provider_id,idempotency_key,
         amount_minor,currency,status,device_id
       ) VALUES ('owned-attempt','owned-payment',$1,'owned-order','fake','owned-idem',10000,'KES','UNKNOWN',$2)`,
      [DEFAULT_DEVICE_EVENT_ID, deviceId],
    );
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await request(app.getHttpServer())
      .post('/payments/attempts/owned-attempt/reconcile')
      .set(posDeviceHeaders(peerDevice))
      .send({})
      .expect(401);
    await request(app.getHttpServer())
      .get('/payments/orders/owned-order')
      .set(posDeviceHeaders(peerDevice))
      .expect(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('enforces a reassigned event immediately with the same device credential', async () => {
    await database.query(
      `UPDATE edge_pos_devices SET event_id=$2,updated_at=now() WHERE device_id=$1`,
      [deviceId, otherEventId],
    );

    await request(app.getHttpServer())
      .post('/sync/device-events')
      .set(posDeviceHeaders(deviceId))
      .send(syncBody())
      .expect(401);
    await request(app.getHttpServer())
      .post('/sync/device-events')
      .set(posDeviceHeaders(deviceId))
      .send(syncBody(otherEventId))
      .expect(201);
  });
});
