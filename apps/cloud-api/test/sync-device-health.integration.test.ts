import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { provisionOperator } from './operator-auth-testkit';
import { provisionSyncEdge } from './sync-auth-testkit';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration('operator sync device health', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let viewerHeaders: Record<string, string>;
  let platformHeaders: (organisationId?: string) => Record<string, string>;
  const organisationId = randomUUID();
  const otherOrganisationId = randomUUID();

  beforeAll(async () => {
    process.env.PAYMENT_RECONCILIATION_DISABLED = 'true';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    database = moduleRef.get(DatabaseService);
    await app.init();

    await database.query(
      `INSERT INTO organisations(id,name,lifecycle)
       VALUES ($1,'Sync health organisation','ACTIVE'),($2,'Other sync health organisation','ACTIVE')
       ON CONFLICT (id) DO NOTHING`,
      [organisationId, otherOrganisationId],
    );
  });

  beforeEach(async () => {
    await database.query(
      'TRUNCATE pos_menu_install_receipts, pos_menu_publications, operator_login_challenges, operator_auth_audit, operator_sessions, operator_memberships, operator_identities, sync_pos_device_roster, sync_device_state',
    );
    await database.query(
      `INSERT INTO sync_device_state(
         device_id,last_seen_at,last_sequence_seen,edge_accepted_through_sequence,
         edge_backlog_count,last_cloud_delivery_at,organisation_id
       ) VALUES
         ('register-alpha','2026-08-21T05:00:00Z',18,17,1,'2026-08-21T04:59:50Z',$1),
         ('register-other','2026-08-21T05:01:00Z',9,9,0,'2026-08-21T05:00:55Z',$2)`,
      [organisationId, otherOrganisationId],
    );

    const viewer = await provisionOperator(database, {
      actorId: randomUUID(),
      memberships: [{ organisationId, role: 'VIEWER' }],
    });
    viewerHeaders = viewer.headers(organisationId);

    const platform = await provisionOperator(database, {
      actorId: randomUUID(),
      platformAdmin: true,
    });
    platformHeaders = platform.headers;
  });

  afterAll(async () => {
    delete process.env.PAYMENT_RECONCILIATION_DISABLED;
    await app.close();
  });

  it('requires an operator bearer session and selected organisation', async () => {
    await request(app.getHttpServer())
      .get('/sync/devices')
      .set('x-organisation-id', organisationId)
      .expect(401);

    const viewer = await provisionOperator(database, {
      actorId: randomUUID(),
      memberships: [{ organisationId, role: 'VIEWER' }],
    });
    await request(app.getHttpServer()).get('/sync/devices').set(viewer.headers()).expect(401);
  });

  it('returns only device telemetry for the operator organisation', async () => {
    const response = await request(app.getHttpServer())
      .get('/sync/devices')
      .set(viewerHeaders)
      .expect(200);

    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      deviceId: 'register-alpha',
      lastSeenAt: '2026-08-21T05:00:00.000Z',
      lastSequenceSeen: 18,
      edgeAcceptedThroughSequence: 17,
      edgeBacklogCount: 1,
      lastCloudDeliveryAt: '2026-08-21T04:59:50.000Z',
      operationalStatus: 'STALE',
    });
    expect(response.body[0].syncAgeSeconds).toBeGreaterThan(120);
  });

  it('includes an active provisioned register before it has ever reported telemetry', async () => {
    const eventId = randomUUID();
    const edgeId = 'sync-health-roster-edge';
    await provisionSyncEdge(database, {
      edgeId,
      organisationId,
      eventIds: [eventId],
    });
    await database.query(
      `INSERT INTO sync_device_state(
         device_id,last_seen_at,last_sequence_seen,edge_accepted_through_sequence,
         edge_backlog_count,last_cloud_delivery_at,edge_id,organisation_id
       ) VALUES ('register-never-seen','2026-08-29T17:59:00Z',5,5,0,
                 '2026-08-29T17:59:00Z',$2,$1)`,
      [organisationId, edgeId],
    );
    await database.query(
      `INSERT INTO sync_pos_device_roster(
         device_id,organisation_id,edge_id,event_id,sales_location_id,register_id,
         status,source_updated_at
       ) VALUES ('register-never-seen',$1,$2,$3,NULL,'Till 02','ACTIVE',
                 '2026-08-29T18:00:00Z')`,
      [organisationId, edgeId, eventId],
    );

    const response = await request(app.getHttpServer())
      .get('/sync/devices')
      .set(viewerHeaders)
      .expect(200);

    const expected = response.body.find(
      (device: { deviceId: string }) => device.deviceId === 'register-never-seen',
    );
    expect(response.body).toHaveLength(2);
    expect(expected).toMatchObject({
      deviceId: 'register-never-seen',
      lastSeenAt: null,
      lastSequenceSeen: 0,
      edgeAcceptedThroughSequence: 0,
      edgeBacklogCount: 0,
      lastCloudDeliveryAt: null,
      syncAgeSeconds: null,
      operationalStatus: 'STALE',
    });

    await database.query(
      `UPDATE sync_pos_device_roster
       SET status='REVOKED',source_updated_at='2026-08-29T18:01:00Z',received_at=now()
       WHERE device_id='register-never-seen'`,
    );
    const afterRevocation = await request(app.getHttpServer())
      .get('/sync/devices')
      .set(viewerHeaders)
      .expect(200);
    expect(afterRevocation.body.map((device: { deviceId: string }) => device.deviceId)).toEqual([
      'register-alpha',
    ]);
  });

  it('rejects cross-organisation access for an organisation operator', async () => {
    await request(app.getHttpServer())
      .get('/sync/devices')
      .set({ ...viewerHeaders, 'x-organisation-id': otherOrganisationId })
      .expect(403);
  });

  it('allows a platform administrator to inspect a selected organisation', async () => {
    const response = await request(app.getHttpServer())
      .get('/sync/devices')
      .set(platformHeaders(otherOrganisationId))
      .expect(200);

    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      deviceId: 'register-other',
      lastSeenAt: '2026-08-21T05:01:00.000Z',
      lastSequenceSeen: 9,
      edgeAcceptedThroughSequence: 9,
      edgeBacklogCount: 0,
      lastCloudDeliveryAt: '2026-08-21T05:00:55.000Z',
      operationalStatus: 'STALE',
    });
    expect(response.body[0].syncAgeSeconds).toBeGreaterThan(120);
  });
});
