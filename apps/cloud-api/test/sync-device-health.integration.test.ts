import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { provisionOperator } from './operator-auth-testkit';

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
      'TRUNCATE pos_menu_publications, operator_login_challenges, operator_auth_audit, operator_sessions, operator_memberships, operator_identities, sync_device_state',
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

    expect(response.body).toEqual([
      {
        deviceId: 'register-alpha',
        lastSeenAt: '2026-08-21T05:00:00.000Z',
        lastSequenceSeen: 18,
        edgeAcceptedThroughSequence: 17,
        edgeBacklogCount: 1,
        lastCloudDeliveryAt: '2026-08-21T04:59:50.000Z',
      },
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

    expect(response.body).toEqual([
      {
        deviceId: 'register-other',
        lastSeenAt: '2026-08-21T05:01:00.000Z',
        lastSequenceSeen: 9,
        edgeAcceptedThroughSequence: 9,
        edgeBacklogCount: 0,
        lastCloudDeliveryAt: '2026-08-21T05:00:55.000Z',
      },
    ]);
  });
});
