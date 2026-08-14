import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { EdgeDatabaseService } from '../src/database/database.service';
import { InventoryConfigurationService } from '../src/inventory/inventory-configuration.service';
import {
  beerSkuId,
  installInventoryFixture,
  inventoryEventId,
  mainLocationId,
  resetInventory,
} from './inventory-fixture';
import {
  edgeOperatorHeaders,
  edgeOperatorToken,
  enableEdgeOperatorTestAuth,
} from './operator-edge-auth-testkit';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;
const actorId = '61111111-1111-4111-8111-111111111111';
const deniedActorId = '61111111-1111-4111-8111-222222222222';
const adminActorId = '61111111-1111-4111-8111-333333333333';
const otherOrganisationId = '51111111-1111-4111-8111-222222222222';

describeIntegration('offline Event Edge operator authorization', () => {
  let app: INestApplication;
  let database: EdgeDatabaseService;
  let configuration: InventoryConfigurationService;

  beforeAll(async () => {
    process.env.EDGE_FORWARDER_DISABLED = 'true';
    enableEdgeOperatorTestAuth();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    database = moduleRef.get(EdgeDatabaseService);
    configuration = moduleRef.get(InventoryConfigurationService);
    await app.init();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await resetInventory(database);
    await installInventoryFixture(configuration);
    await database.query(
      `INSERT INTO edge_inventory_actor_permissions(event_id,actor_id,permission)
       VALUES ($1,$2,'INVENTORY_MOVE')
       ON CONFLICT (event_id,actor_id,permission) DO NOTHING`,
      [inventoryEventId, actorId],
    );
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env.EDGE_FORWARDER_DISABLED;
    delete process.env.OPERATOR_TOKEN_VERIFYING_PUBLIC_KEY;
    delete process.env.EDGE_ORGANISATION_ID;
    await app.close();
  });

  it('rejects anonymous, tampered, expired and wrong-organisation operator tokens', async () => {
    await request(app.getHttpServer())
      .get(`/inventory/events/${inventoryEventId}/stock`)
      .expect(401);

    const valid = edgeOperatorToken({ actorId });
    const last = valid.at(-1) === 'A' ? 'B' : 'A';
    await request(app.getHttpServer())
      .get(`/inventory/events/${inventoryEventId}/stock`)
      .set({ authorization: `Bearer ${valid.slice(0, -1)}${last}` })
      .expect(401);

    const now = Math.floor(Date.now() / 1000);
    await request(app.getHttpServer())
      .get(`/inventory/events/${inventoryEventId}/stock`)
      .set({
        authorization: `Bearer ${edgeOperatorToken({
          actorId,
          issuedAt: now - 1000,
          expiresAt: now - 1,
        })}`,
      })
      .expect(401);

    await request(app.getHttpServer())
      .get(`/inventory/events/${inventoryEventId}/stock`)
      .set(edgeOperatorHeaders(actorId, { organisationId: otherOrganisationId }))
      .expect(403);
  });

  it('rejects caller-supplied actor spoofing before a manual movement is written', async () => {
    await request(app.getHttpServer())
      .post('/inventory/movements')
      .set(edgeOperatorHeaders(actorId))
      .send({
        id: 'movement-spoofed',
        eventId: inventoryEventId,
        inventoryLocationId: mainLocationId,
        skuId: beerSkuId,
        movementType: 'RECEIPT',
        quantityDeltaBase: '10',
        actorId: deniedActorId,
        reason: 'spoofed actor test',
        occurredAt: '2026-08-14T08:00:00.000Z',
        idempotencyKey: 'movement-spoofed-idem',
      })
      .expect(403);

    const rows = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM edge_inventory_ledger WHERE id='movement-spoofed'`,
    );
    expect(rows[0]?.count).toBe('0');
  });

  it('still requires the existing local inventory permission after token verification', async () => {
    await request(app.getHttpServer())
      .post('/inventory/movements')
      .set(edgeOperatorHeaders(deniedActorId))
      .send({
        id: 'movement-denied',
        eventId: inventoryEventId,
        inventoryLocationId: mainLocationId,
        skuId: beerSkuId,
        movementType: 'RECEIPT',
        quantityDeltaBase: '10',
        actorId: deniedActorId,
        reason: 'permission denial test',
        occurredAt: '2026-08-14T08:00:00.000Z',
        idempotencyKey: 'movement-denied-idem',
      })
      .expect(403);

    const rows = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM edge_inventory_ledger WHERE id='movement-denied'`,
    );
    expect(rows[0]?.count).toBe('0');
  });

  it('executes an authorized local inventory action with Cloud transport unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('WAN unavailable')));

    const response = await request(app.getHttpServer())
      .post('/inventory/movements')
      .set(edgeOperatorHeaders(actorId))
      .send({
        id: 'movement-offline-authorized',
        eventId: inventoryEventId,
        inventoryLocationId: mainLocationId,
        skuId: beerSkuId,
        movementType: 'RECEIPT',
        quantityDeltaBase: '10',
        actorId,
        reason: 'offline authorization test',
        occurredAt: '2026-08-14T08:00:00.000Z',
        idempotencyKey: 'movement-offline-authorized-idem',
      })
      .expect(201);

    expect(response.body).toMatchObject({
      id: 'movement-offline-authorized',
      eventId: inventoryEventId,
      quantityDeltaBase: '10',
    });
    const rows = await database.query<{ actor_id: string }>(
      `SELECT actor_id FROM edge_inventory_ledger WHERE id='movement-offline-authorized'`,
    );
    expect(rows[0]?.actor_id).toBe(actorId);
  });

  it('requires an administrative signed role to install inventory configuration', async () => {
    const payload = {
      eventId: 'new-secure-event',
      eventEndAt: '2026-08-15T22:00:00.000Z',
      locations: [],
      skus: [],
      salesMappings: [],
      recipes: [],
      alertConfigs: [],
      responsibilities: [],
      permissions: [],
      sourceActorId: actorId,
    };

    await request(app.getHttpServer())
      .post('/inventory/configuration/snapshot')
      .set(edgeOperatorHeaders(actorId))
      .send(payload)
      .expect(403);

    await request(app.getHttpServer())
      .post('/inventory/configuration/snapshot')
      .set(edgeOperatorHeaders(adminActorId, { role: 'ADMIN' }))
      .send(payload)
      .expect(403);

    await request(app.getHttpServer())
      .post('/inventory/configuration/snapshot')
      .set(edgeOperatorHeaders(adminActorId, { role: 'ADMIN' }))
      .send({ ...payload, sourceActorId: adminActorId })
      .expect(201);
  });
});
