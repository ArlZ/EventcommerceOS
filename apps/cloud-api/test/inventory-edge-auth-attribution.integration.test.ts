import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import {
  DEFAULT_SYNC_EVENT_ID,
  DEFAULT_SYNC_ORGANISATION_ID,
  provisionSyncEdge,
} from './sync-auth-testkit';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;
const edgeId = 'inventory-attribution-edge';

describeIntegration('inventory Edge authenticated attribution', () => {
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
      `TRUNCATE inventory_edge_events, edge_sync_client_audit, edge_sync_clients CASCADE`,
    );
    authHeaders = (await provisionSyncEdge(database, { edgeId })).headers;
  });

  afterAll(async () => {
    delete process.env.PAYMENT_RECONCILIATION_DISABLED;
    await app.close();
  });

  it('stores the authenticated Edge and organisation on durable inventory ingress', async () => {
    await request(app.getHttpServer())
      .post('/inventory/edge-events')
      .set(authHeaders)
      .send({
        edgeId,
        events: [
          {
            id: 'inventory-attribution-event',
            eventType: 'INVENTORY_CONFIGURATION_INSTALLED',
            aggregateType: 'INVENTORY_EVENT',
            aggregateId: DEFAULT_SYNC_EVENT_ID,
            payload: { eventId: DEFAULT_SYNC_EVENT_ID, sourceActorId: 'security-test' },
          },
        ],
      })
      .expect(201);

    const rows = await database.query<{ edge_id: string; organisation_id: string }>(
      `SELECT edge_id,organisation_id::text
       FROM inventory_edge_events WHERE id='inventory-attribution-event'`,
    );
    expect(rows[0]).toEqual({
      edge_id: edgeId,
      organisation_id: DEFAULT_SYNC_ORGANISATION_ID,
    });
  });
});
