import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { OperatorAuthService } from '../src/auth/operator-auth.service';
import { DatabaseService } from '../src/database/database.service';
import {
  enableOperatorTestSigningKey,
  operatorCredential,
  operatorHeaders,
  provisionOperator,
} from './operator-auth-testkit';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;
const organisationOne = '31111111-1111-4111-8111-111111111111';
const organisationTwo = '31111111-1111-4111-8111-222222222222';
const adminActor = '41111111-1111-4111-8111-111111111111';
const platformActor = '41111111-1111-4111-8111-222222222222';
const operatorActor = '41111111-1111-4111-8111-333333333333';

describeIntegration('signed operator authentication and admin boundary', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let auth: OperatorAuthService;

  beforeAll(async () => {
    enableOperatorTestSigningKey();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    database = moduleRef.get(DatabaseService);
    auth = moduleRef.get(OperatorAuthService);
    await app.init();
  });

  beforeEach(async () => {
    await database.query(
      `DELETE FROM payment_actor_permissions
       WHERE actor_id IN ($1,$2,$3)`,
      [adminActor, platformActor, operatorActor],
    );
    await database.query(
      `DELETE FROM operator_account_audit
       WHERE actor_id IN ($1,$2,$3)`,
      [adminActor, platformActor, operatorActor],
    );
    await database.query(
      `DELETE FROM operator_accounts
       WHERE actor_id IN ($1,$2,$3)`,
      [adminActor, platformActor, operatorActor],
    );
    await database.query(
      `INSERT INTO organisations(id,name,lifecycle)
       VALUES ($1,'Operator auth org one','ACTIVE'),($2,'Operator auth org two','ACTIVE')
       ON CONFLICT (id) DO NOTHING`,
      [organisationOne, organisationTwo],
    );
  });

  afterAll(async () => {
    delete process.env.OPERATOR_TOKEN_SIGNING_KEY;
    delete process.env.OPERATOR_ACCESS_TOKEN_TTL_SECONDS;
    await app.close();
  });

  it('rejects legacy admin headers when no signed operator token is present', async () => {
    await request(app.getHttpServer())
      .post('/organisations')
      .set({
        'x-actor-id': randomUUID(),
        'x-role': 'PLATFORM_ADMIN',
      })
      .send({ name: 'Header spoof org' })
      .expect(401);
  });

  it('does not let a lower-role token escalate through caller-supplied role headers', async () => {
    await provisionOperator(database, {
      actorId: operatorActor,
      organisationId: organisationOne,
      role: 'OPERATOR',
    });
    const headers = await operatorHeaders(auth, operatorActor);

    await request(app.getHttpServer())
      .post('/organisations')
      .set({
        ...headers,
        'x-role': 'PLATFORM_ADMIN',
        'x-actor-id': platformActor,
      })
      .send({ name: 'Should not exist' })
      .expect(403);
  });

  it('issues a short-lived signed session only for the correct static credential', async () => {
    await provisionOperator(database, {
      actorId: adminActor,
      organisationId: organisationOne,
      role: 'ADMIN',
    });

    await request(app.getHttpServer())
      .post('/auth/operator/session')
      .send({ actorId: adminActor, credential: `${operatorCredential(adminActor)}-wrong` })
      .expect(401);

    const response = await request(app.getHttpServer())
      .post('/auth/operator/session')
      .send({ actorId: adminActor, credential: operatorCredential(adminActor) })
      .expect(201);
    expect(response.body.tokenType).toBe('Bearer');
    expect(response.body.actorId).toBe(adminActor);
    expect(response.body.organisationId).toBe(organisationOne);
    expect(response.body.role).toBe('ADMIN');
    expect(response.body.expiresInSeconds).toBe(900);
    expect(response.body.accessToken.split('.')).toHaveLength(3);
  });

  it('rejects a tampered access token', async () => {
    await provisionOperator(database, {
      actorId: adminActor,
      organisationId: organisationOne,
      role: 'ADMIN',
    });
    const session = await auth.createSession(adminActor, operatorCredential(adminActor));
    const last = session.accessToken.at(-1) === 'A' ? 'B' : 'A';
    const tampered = `${session.accessToken.slice(0, -1)}${last}`;

    await request(app.getHttpServer())
      .post('/auth/operator/revoke-sessions')
      .set({ authorization: `Bearer ${tampered}` })
      .send({})
      .expect(401);
  });

  it('invalidates all existing access tokens immediately when sessions are revoked', async () => {
    await provisionOperator(database, {
      actorId: adminActor,
      organisationId: organisationOne,
      role: 'ADMIN',
    });
    const headers = await operatorHeaders(auth, adminActor);

    await request(app.getHttpServer())
      .post('/auth/operator/revoke-sessions')
      .set(headers)
      .send({})
      .expect(201);

    await request(app.getHttpServer())
      .post('/events')
      .set(headers)
      .send({
        organisationId: organisationOne,
        name: 'Stale token event',
        timezone: 'Africa/Nairobi',
        startsAt: '2026-09-01T18:00:00+03:00',
        endsAt: '2026-09-02T02:00:00+03:00',
      })
      .expect(401);
  });

  it('invalidates access tokens immediately when the operator credential version rotates', async () => {
    await provisionOperator(database, {
      actorId: adminActor,
      organisationId: organisationOne,
      role: 'ADMIN',
    });
    const headers = await operatorHeaders(auth, adminActor);
    await database.query(
      `UPDATE operator_accounts
       SET credential_version=credential_version+1,session_version=session_version+1,updated_at=now()
       WHERE actor_id=$1`,
      [adminActor],
    );

    await request(app.getHttpServer())
      .post('/auth/operator/revoke-sessions')
      .set(headers)
      .send({})
      .expect(401);
  });

  it('derives organisation scope from the signed account instead of spoofed organisation headers', async () => {
    await provisionOperator(database, {
      actorId: adminActor,
      organisationId: organisationOne,
      role: 'ADMIN',
    });
    const headers = await operatorHeaders(auth, adminActor);

    await request(app.getHttpServer())
      .post('/events')
      .set({ ...headers, 'x-organisation-id': organisationTwo, 'x-role': 'PLATFORM_ADMIN' })
      .send({
        organisationId: organisationTwo,
        name: 'Cross-tenant event',
        timezone: 'Africa/Nairobi',
        startsAt: '2026-09-01T18:00:00+03:00',
        endsAt: '2026-09-02T02:00:00+03:00',
      })
      .expect(403);
  });

  it('allows a real platform administrator to perform cross-organisation bootstrap actions', async () => {
    await provisionOperator(database, {
      actorId: platformActor,
      organisationId: null,
      role: 'PLATFORM_ADMIN',
    });
    const headers = await operatorHeaders(auth, platformActor);
    const response = await request(app.getHttpServer())
      .post('/organisations')
      .set(headers)
      .send({ name: `Signed platform org ${randomUUID().slice(0, 8)}` })
      .expect(201);
    expect(response.body.id).toBeTruthy();
  });
});
