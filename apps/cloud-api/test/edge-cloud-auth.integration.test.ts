import 'reflect-metadata';
import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type {
  EdgeCloudBatch,
  InventoryEdgeBatch,
  SyncEventEnvelope,
} from '@event-commerce/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import {
  DEFAULT_SYNC_EVENT_ID,
  DEFAULT_SYNC_ORGANISATION_ID,
  provisionSyncEdge,
  revokeSyncEdge,
  syncEdgeHeaders,
} from './sync-auth-testkit';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;
const otherOrganisationId = '11111111-1111-4111-8111-222222222222';
const otherEventId = '22222222-2222-4222-8222-444444444444';
const edgeA = 'edge-security-a';
const edgeB = 'edge-security-b';
const tokenA = 'edge-security-token-a-0123456789-abcdefghijklmnopqrstuvwxyz';
const tokenB = 'edge-security-token-b-0123456789-abcdefghijklmnopqrstuvwxyz';

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function orderEvent(
  eventInstanceId: string,
  businessEventId: string,
  deviceId: string,
  sequence: number,
  orderId: string,
): SyncEventEnvelope {
  return {
    schemaVersion: 1,
    eventInstanceId,
    eventId: `envelope-${eventInstanceId}`,
    eventType: 'ORDER_CHANGED',
    aggregateType: 'ORDER',
    aggregateId: orderId,
    eventVersion: 1,
    deviceId,
    sequence,
    occurredAt: new Date(1_780_100_000_000 + sequence * 1000).toISOString(),
    idempotencyKey: `idem-${eventInstanceId}`,
    payload: {
      orderId,
      eventId: businessEventId,
      state: 'OPEN',
      totalMinor: 10_000,
      currency: 'KES',
    },
  };
}

function syncBatch(
  edgeId: string,
  event: SyncEventEnvelope,
  includeStatus = false,
): EdgeCloudBatch {
  return {
    edgeId,
    events: [event],
    deviceStatuses: includeStatus
      ? [
          {
            deviceId: event.deviceId,
            lastSeenAt: event.occurredAt,
            lastSequenceSeen: event.sequence,
            edgeAcceptedThroughSequence: event.sequence,
            edgeBacklogCount: 0,
            lastCloudDeliveryAt: null,
          },
        ]
      : [],
  };
}

function inventoryBatch(edgeId: string, businessEventId: string, id: string): InventoryEdgeBatch {
  return {
    edgeId,
    events: [
      {
        id,
        eventType: 'INVENTORY_CONFIGURATION_INSTALLED',
        aggregateType: 'INVENTORY_EVENT',
        aggregateId: businessEventId,
        payload: { eventId: businessEventId, sourceActorId: 'security-test' },
      },
    ],
  };
}

describeIntegration('authenticated Event Edge Cloud ingress', () => {
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
      `TRUNCATE
         inventory_reconciliation_exceptions,
         inventory_count_projection,
         inventory_alert_projection,
         inventory_transfer_projection,
         inventory_ledger,
         inventory_edge_events,
         sync_reconciliation_exceptions,
         sync_device_state,
         sync_order_state,
         sync_processed_events,
         edge_sync_client_audit,
         edge_sync_clients,
         events,
         organisations
       CASCADE`,
    );
    await provisionSyncEdge(database, {
      edgeId: edgeA,
      organisationId: DEFAULT_SYNC_ORGANISATION_ID,
      eventIds: [DEFAULT_SYNC_EVENT_ID],
      token: tokenA,
    });
    await provisionSyncEdge(database, {
      edgeId: edgeB,
      organisationId: otherOrganisationId,
      eventIds: [otherEventId],
      token: tokenB,
    });
  });

  afterAll(async () => {
    delete process.env.PAYMENT_RECONCILIATION_DISABLED;
    await app.close();
  });

  it('rejects missing, invalid, unknown and body-mismatched Edge credentials', async () => {
    const body = syncBatch(
      edgeA,
      orderEvent('auth-basic', DEFAULT_SYNC_EVENT_ID, 'auth-device', 1, 'auth-order'),
    );

    await request(app.getHttpServer()).post('/sync/edge-events').send(body).expect(401);
    await request(app.getHttpServer())
      .post('/sync/edge-events')
      .set(syncEdgeHeaders(edgeA, `${tokenA}-wrong`))
      .send(body)
      .expect(401);
    await request(app.getHttpServer())
      .post('/sync/edge-events')
      .set(syncEdgeHeaders('edge-does-not-exist', tokenA))
      .send({ ...body, edgeId: 'edge-does-not-exist' })
      .expect(401);
    await request(app.getHttpServer())
      .post('/sync/edge-events')
      .set(syncEdgeHeaders(edgeA, tokenA))
      .send({ ...body, edgeId: edgeB })
      .expect(401);

    const rows = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM sync_processed_events',
    );
    expect(rows[0]!.count).toBe('0');
  });

  it('rejects an authenticated Edge attempting to send another organisation event', async () => {
    const body = syncBatch(
      edgeA,
      orderEvent('wrong-org', otherEventId, 'wrong-org-device', 1, 'wrong-org-order'),
    );
    await request(app.getHttpServer())
      .post('/sync/edge-events')
      .set(syncEdgeHeaders(edgeA, tokenA))
      .send(body)
      .expect(401);

    const rows = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM sync_processed_events',
    );
    expect(rows[0]!.count).toBe('0');
  });

  it('attributes accepted sync truth to the authenticated Edge and organisation', async () => {
    const event = orderEvent(
      'accepted',
      DEFAULT_SYNC_EVENT_ID,
      'accepted-device',
      1,
      'accepted-order',
    );
    await request(app.getHttpServer())
      .post('/sync/edge-events')
      .set(syncEdgeHeaders(edgeA, tokenA))
      .send(syncBatch(edgeA, event, true))
      .expect(201);

    const processed = await database.query<{
      edge_id: string;
      organisation_id: string;
    }>(
      `SELECT edge_id,organisation_id::text
       FROM sync_processed_events WHERE event_instance_id=$1`,
      [event.eventInstanceId],
    );
    const device = await database.query<{ edge_id: string; organisation_id: string }>(
      `SELECT edge_id,organisation_id::text FROM sync_device_state WHERE device_id=$1`,
      [event.deviceId],
    );
    expect(processed[0]).toEqual({ edge_id: edgeA, organisation_id: DEFAULT_SYNC_ORGANISATION_ID });
    expect(device[0]).toEqual({ edge_id: edgeA, organisation_id: DEFAULT_SYNC_ORGANISATION_ID });
  });

  it('rejects a revoked Edge immediately', async () => {
    await revokeSyncEdge(database, edgeA);
    const body = syncBatch(
      edgeA,
      orderEvent('revoked', DEFAULT_SYNC_EVENT_ID, 'revoked-device', 1, 'revoked-order'),
    );
    await request(app.getHttpServer())
      .post('/sync/edge-events')
      .set(syncEdgeHeaders(edgeA, tokenA))
      .send(body)
      .expect(401);
  });

  it('invalidates the previous credential on rotation and accepts the new credential', async () => {
    const rotatedToken = 'edge-security-token-rotated-0123456789-abcdefghijklmnopqrstuvwxyz';
    await database.query(
      `UPDATE edge_sync_clients
       SET credential_sha256=$2,credential_version=credential_version+1,last_authenticated_at=NULL,updated_at=now()
       WHERE edge_id=$1`,
      [edgeA, digest(rotatedToken)],
    );
    const body = syncBatch(
      edgeA,
      orderEvent('rotated', DEFAULT_SYNC_EVENT_ID, 'rotated-device', 1, 'rotated-order'),
    );

    await request(app.getHttpServer())
      .post('/sync/edge-events')
      .set(syncEdgeHeaders(edgeA, tokenA))
      .send(body)
      .expect(401);
    await request(app.getHttpServer())
      .post('/sync/edge-events')
      .set(syncEdgeHeaders(edgeA, rotatedToken))
      .send(body)
      .expect(201);
  });

  it('prevents a second organisation from taking over an attributed device id', async () => {
    const sharedDevice = 'globally-shared-device';
    const first = orderEvent('device-a', DEFAULT_SYNC_EVENT_ID, sharedDevice, 1, 'device-order-a');
    await request(app.getHttpServer())
      .post('/sync/edge-events')
      .set(syncEdgeHeaders(edgeA, tokenA))
      .send(syncBatch(edgeA, first, true))
      .expect(201);

    const second = orderEvent('device-b', otherEventId, sharedDevice, 1, 'device-order-b');
    await request(app.getHttpServer())
      .post('/sync/edge-events')
      .set(syncEdgeHeaders(edgeB, tokenB))
      .send(syncBatch(edgeB, second, true))
      .expect(409);

    const state = await database.query<{ organisation_id: string; edge_id: string }>(
      `SELECT organisation_id::text,edge_id FROM sync_device_state WHERE device_id=$1`,
      [sharedDevice],
    );
    const secondEvent = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM sync_processed_events WHERE event_instance_id=$1',
      [second.eventInstanceId],
    );
    expect(state[0]).toEqual({ organisation_id: DEFAULT_SYNC_ORGANISATION_ID, edge_id: edgeA });
    expect(secondEvent[0]!.count).toBe('0');
  });

  it('scopes device sequence replay protection by organisation', async () => {
    const sharedDevice = 'same-device-sequence-without-status';
    const first = orderEvent('seq-a', DEFAULT_SYNC_EVENT_ID, sharedDevice, 7, 'seq-order-a');
    const second = orderEvent('seq-b', otherEventId, sharedDevice, 7, 'seq-order-b');

    await request(app.getHttpServer())
      .post('/sync/edge-events')
      .set(syncEdgeHeaders(edgeA, tokenA))
      .send(syncBatch(edgeA, first))
      .expect(201);
    await request(app.getHttpServer())
      .post('/sync/edge-events')
      .set(syncEdgeHeaders(edgeB, tokenB))
      .send(syncBatch(edgeB, second))
      .expect(201);

    const rows = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM sync_processed_events
       WHERE device_id=$1 AND sequence=7`,
      [sharedDevice],
    );
    expect(rows[0]!.count).toBe('2');
  });

  it('applies the same authentication and tenant binding to inventory Edge ingress', async () => {
    const valid = inventoryBatch(edgeA, DEFAULT_SYNC_EVENT_ID, 'inventory-auth-valid');
    await request(app.getHttpServer()).post('/inventory/edge-events').send(valid).expect(401);
    await request(app.getHttpServer())
      .post('/inventory/edge-events')
      .set(syncEdgeHeaders(edgeA, tokenA))
      .send(inventoryBatch(edgeA, otherEventId, 'inventory-auth-wrong-org'))
      .expect(401);
    await request(app.getHttpServer())
      .post('/inventory/edge-events')
      .set(syncEdgeHeaders(edgeA, tokenA))
      .send(valid)
      .expect(201);

    const rows = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM inventory_edge_events WHERE id=$1',
      ['inventory-auth-valid'],
    );
    expect(rows[0]!.count).toBe('1');
  });
});
