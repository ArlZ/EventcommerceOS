import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { provisionOperator, revokeOperatorSession } from './operator-auth-testkit';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration('operator Event Control context boundary', () => {
  let app: INestApplication;
  let database: DatabaseService;
  const allowedOrganisationId = randomUUID();
  const deniedOrganisationId = randomUUID();
  const allowedEventId = randomUUID();
  const deniedEventId = randomUUID();

  beforeAll(async () => {
    process.env.PAYMENT_RECONCILIATION_DISABLED = 'true';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    database = moduleRef.get(DatabaseService);
    await app.init();

    await database.query(
      `INSERT INTO organisations(id,name)
       VALUES ($1,'Allowed context org'),($2,'Denied context org')`,
      [allowedOrganisationId, deniedOrganisationId],
    );
    await database.query(
      `INSERT INTO events(id,organisation_id,name,timezone,lifecycle,starts_at,ends_at)
       VALUES
         ($1,$2,'Allowed context event','Africa/Nairobi','ACTIVE',now()-interval '1 hour',now()+interval '4 hours'),
         ($3,$4,'Denied context event','Africa/Nairobi','ACTIVE',now()-interval '1 hour',now()+interval '4 hours')`,
      [allowedEventId, allowedOrganisationId, deniedEventId, deniedOrganisationId],
    );
  });

  afterAll(async () => {
    delete process.env.PAYMENT_RECONCILIATION_DISABLED;
    await app.close();
  });

  it('returns only organisations and events assigned to the authenticated operator', async () => {
    const operator = await provisionOperator(database, {
      actorId: randomUUID(),
      memberships: [{ organisationId: allowedOrganisationId, role: 'ADMIN' }],
    });

    const response = await request(app.getHttpServer())
      .get('/operator-auth/context')
      .set({ ...operator.headers(), 'x-event-control-request': 'browser' })
      .expect(200);

    expect(response.body.organisations).toEqual([
      expect.objectContaining({
        id: allowedOrganisationId,
        role: 'ADMIN',
        events: [expect.objectContaining({ id: allowedEventId })],
      }),
    ]);
    expect(JSON.stringify(response.body)).not.toContain(deniedOrganisationId);
    expect(JSON.stringify(response.body)).not.toContain(deniedEventId);
  });

  it('does not allow spoofed role or organisation headers to expand context', async () => {
    const operator = await provisionOperator(database, {
      actorId: randomUUID(),
      memberships: [{ organisationId: allowedOrganisationId, role: 'VIEWER' }],
    });

    const response = await request(app.getHttpServer())
      .get('/operator-auth/context')
      .set({
        ...operator.headers(deniedOrganisationId),
        'x-event-control-request': 'browser',
        'x-role': 'PLATFORM_ADMIN',
        'x-actor-id': randomUUID(),
      })
      .expect(200);

    expect(response.body.organisations).toHaveLength(1);
    expect(response.body.organisations[0]).toMatchObject({
      id: allowedOrganisationId,
      role: 'VIEWER',
    });
    expect(JSON.stringify(response.body)).not.toContain(deniedOrganisationId);
  });

  it('fails closed when the operator session is revoked', async () => {
    const operator = await provisionOperator(database, {
      actorId: randomUUID(),
      memberships: [{ organisationId: allowedOrganisationId, role: 'ADMIN' }],
    });
    await revokeOperatorSession(database, operator.token);

    await request(app.getHttpServer())
      .get('/operator-auth/context')
      .set({ ...operator.headers(), 'x-event-control-request': 'browser' })
      .expect(401);
  });
});
