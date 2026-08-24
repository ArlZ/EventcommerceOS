import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  DeviceCloudStatus,
  EdgeCloudBatch,
  SyncEventEnvelope,
} from '@event-commerce/contracts';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import {
  DEFAULT_SYNC_EVENT_ID,
  DEFAULT_SYNC_ORGANISATION_ID,
  provisionSyncEdge,
} from './sync-auth-testkit';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;
const edgeId = 'test-edge';

function event(
  deviceId: string,
  sequence: number,
  orderId: string,
  state: 'OPEN' | 'CLOSED',
  suffix = '',
): SyncEventEnvelope {
  const token = `${deviceId}-${sequence}-${orderId}${suffix}`;
  return {
    schemaVersion: 1,
    eventInstanceId: `instance-${token}`,
    eventId: `event-${token}`,
    eventType: state === 'CLOSED' ? 'ORDER_CLOSED_CASH' : 'ORDER_CHANGED',
    aggregateType: 'ORDER',
    aggregateId: orderId,
    eventVersion: 1,
    deviceId,
    sequence,
    occurredAt: new Date(1_780_100_000_000 + sequence * 1000).toISOString(),
    idempotencyKey: `idem-${token}`,
    payload: {
      orderId,
      eventId: DEFAULT_SYNC_EVENT_ID,
      state,
      totalMinor: sequence * 25_000,
      currency: 'KES',
    },
  };
}

function status(deviceId: string, sequence: number, backlog = 0): DeviceCloudStatus {
  return {
    deviceId,
    lastSeenAt: new Date(1_780_100_100_000).toISOString(),
    lastSequenceSeen: sequence,
    edgeAcceptedThroughSequence: sequence,
    edgeBacklogCount: backlog,
    lastCloudDeliveryAt: null,
  };
}

function batch(events: SyncEventEnvelope[], backlog = 0): EdgeCloudBatch {
  const devices = [...new Set(events.map((item) => item.deviceId))];
  return {
    edgeId,
    events,
    deviceStatuses: devices.map((deviceId) =>
      status(
        deviceId,
        Math.max(
          ...events.filter((item) => item.deviceId === deviceId).map((item) => item.sequence),
        ),
        backlog,
      ),
    ),
  };
}

describeIntegration('edge to cloud synchronization', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let authHeaders: Record<string, string>;

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
    authHeaders = (await provisionSyncEdge(database, { edgeId })).headers;
  });

  afterAll(async () => {
    await app.close();
  });

  it('delivers the same event twenty times with one cloud business effect', async () => {
    const first = event('cloud-device-1', 1, 'order-replay', 'OPEN');
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await request(app.getHttpServer())
        .post('/sync/edge-events')
        .set(authHeaders)
        .send(batch([first]))
        .expect(201);
      if (attempt === 0)
        expect(response.body.acceptedEventInstanceIds).toEqual([first.eventInstanceId]);
      else expect(response.body.duplicateEventInstanceIds).toEqual([first.eventInstanceId]);
    }
    const processed = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM sync_processed_events',
    );
    const orders = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM sync_order_state',
    );
    expect(processed[0]!.count).toBe('1');
    expect(orders[0]!.count).toBe('1');
  });

  it('allows a permissible late event without regressing a closed order', async () => {
    const closed = event('cloud-device-2', 3, 'order-reordered', 'CLOSED');
    const earlierOpen = event('cloud-device-2', 2, 'order-reordered', 'OPEN');
    await request(app.getHttpServer())
      .post('/sync/edge-events')
      .set(authHeaders)
      .send(batch([closed]))
      .expect(201);
    await request(app.getHttpServer())
      .post('/sync/edge-events')
      .set(authHeaders)
      .send(batch([earlierOpen]))
      .expect(201);

    const rows = await database.query<{
      state: string;
      last_sequence: string;
      total_minor: string;
    }>(
      'SELECT state, last_sequence::text, total_minor::text FROM sync_order_state WHERE order_id = $1',
      ['order-reordered'],
    );
    expect(rows[0]!.state).toBe('CLOSED');
    expect(rows[0]!.last_sequence).toBe('3');
    expect(rows[0]!.total_minor).toBe(String(3 * 25_000));
  });

  it('turns a higher-sequence closed-to-open regression into an explicit exception', async () => {
    const closed = event('cloud-device-3', 3, 'order-conflict', 'CLOSED');
    const unsafeOpen = event('cloud-device-3', 4, 'order-conflict', 'OPEN');
    await request(app.getHttpServer())
      .post('/sync/edge-events')
      .set(authHeaders)
      .send(batch([closed]))
      .expect(201);
    const response = await request(app.getHttpServer())
      .post('/sync/edge-events')
      .set(authHeaders)
      .send(batch([unsafeOpen]))
      .expect(201);
    expect(response.body.conflictEventInstanceIds).toEqual([unsafeOpen.eventInstanceId]);

    const orders = await database.query<{ state: string; last_sequence: string }>(
      'SELECT state, last_sequence::text FROM sync_order_state WHERE order_id = $1',
      ['order-conflict'],
    );
    const exceptions = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM sync_reconciliation_exceptions',
    );
    expect(orders[0]).toEqual({ state: 'CLOSED', last_sequence: '3' });
    expect(exceptions[0]!.count).toBe('1');
  });

  it('rejects a second device claiming an existing order', async () => {
    const original = event('cloud-device-a', 1, 'shared-order', 'OPEN');
    const otherDevice = event('cloud-device-b', 1, 'shared-order', 'OPEN');
    await request(app.getHttpServer())
      .post('/sync/edge-events')
      .set(authHeaders)
      .send(batch([original]))
      .expect(201);
    const response = await request(app.getHttpServer())
      .post('/sync/edge-events')
      .set(authHeaders)
      .send(batch([otherDevice]))
      .expect(201);
    expect(response.body.conflictEventInstanceIds).toEqual([otherDevice.eventInstanceId]);
  });

  it('attributes post-delivery device health and backlog to the authenticated Edge and organisation', async () => {
    const first = event('cloud-device-health', 1, 'health-order', 'OPEN');
    await request(app.getHttpServer())
      .post('/sync/edge-events')
      .set(authHeaders)
      .send(batch([first], 7))
      .expect(201);

    const rows = await database.query<{
      device_id: string;
      edge_id: string;
      organisation_id: string;
      last_sequence_seen: string;
      edge_accepted_through_sequence: string;
      edge_backlog_count: number;
      last_cloud_delivery_at: Date | null;
    }>(
      `SELECT device_id,edge_id,organisation_id::text,last_sequence_seen::text,
              edge_accepted_through_sequence::text,edge_backlog_count,last_cloud_delivery_at
       FROM sync_device_state WHERE device_id=$1`,
      ['cloud-device-health'],
    );
    expect(rows[0]).toEqual({
      device_id: 'cloud-device-health',
      edge_id: edgeId,
      organisation_id: DEFAULT_SYNC_ORGANISATION_ID,
      last_sequence_seen: '1',
      edge_accepted_through_sequence: '1',
      edge_backlog_count: 6,
      last_cloud_delivery_at: expect.any(Date),
    });
  });
});
