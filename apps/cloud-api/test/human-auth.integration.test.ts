import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { HumanAuthService } from '../src/auth/human-auth.service';
import { DatabaseService } from '../src/database/database.service';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;
const ORG_ONE = '51111111-1111-4111-8111-111111111111';
const ORG_TWO = '52222222-2222-4222-8222-222222222222';
const ADMIN_USER = '53333333-3333-4333-8333-333333333333';
const PLATFORM_USER = '54444444-4444-4444-8444-444444444444';
const ADMIN_EMAIL = 'admin-auth-test@example.invalid';
const PLATFORM_EMAIL = 'platform-auth-test@example.invalid';
const PASSWORD = 'correct-horse-battery-staple-auth-test';

async function insertUser(
  database: DatabaseService,
  id: string,
  email: string,
  platformAdmin: boolean,
): Promise<void> {
  const { salt, hash } = await HumanAuthService.passwordDigest(PASSWORD);
  await database.query(
    `INSERT INTO human_users(
       id,email,password_salt,password_hash,status,platform_role,auth_version
     ) VALUES ($1,$2,$3,$4,'ACTIVE',$5,1)`,
    [id, email, salt, hash, platformAdmin ? 'PLATFORM_ADMIN' : null],
  );
}

async function login(
  app: INestApplication,
  email: string,
  organisationId?: string,
): Promise<string> {
  const response = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password: PASSWORD, ...(organisationId ? { organisationId } : {}) })
    .expect(201);
  expect(response.body.accessToken).toEqual(expect.any(String));
  return response.body.accessToken as string;
}

describeIntegration('human session authentication and RBAC', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let database: DatabaseService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    database = moduleRef.get(DatabaseService);
    await app.init();
  });

  beforeEach(async () => {
    await database.query(
      `TRUNCATE human_auth_audit,human_sessions,human_organisation_memberships,human_users CASCADE`,
    );
    await database.query(
      `INSERT INTO organisations(id,name,lifecycle)
       VALUES ($1,'Auth Org One','ACTIVE'),($2,'Auth Org Two','ACTIVE')
       ON CONFLICT (id) DO UPDATE SET lifecycle='ACTIVE',archived_at=NULL`,
      [ORG_ONE, ORG_TWO],
    );
    await insertUser(database, ADMIN_USER, ADMIN_EMAIL, false);
    await insertUser(database, PLATFORM_USER, PLATFORM_EMAIL, true);
    await database.query(
      `INSERT INTO human_organisation_memberships(user_id,organisation_id,role,status)
       VALUES ($1,$2,'ADMIN','ACTIVE')`,
      [ADMIN_USER, ORG_ONE],
    );
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('rejects forged legacy admin headers without a human session', async () => {
    await request(app.getHttpServer())
      .get(`/organisations/${ORG_ONE}`)
      .set('x-actor-id', randomUUID())
      .set('x-role', 'PLATFORM_ADMIN')
      .set('x-organisation-id', ORG_ONE)
      .expect(401);
  });

  it('logs an organisation admin in and ignores spoofed role or organisation headers', async () => {
    const token = await login(app, ADMIN_EMAIL, ORG_ONE);
    await request(app.getHttpServer())
      .get(`/organisations/${ORG_ONE}`)
      .set('authorization', `Bearer ${token}`)
      .set('x-role', 'PLATFORM_ADMIN')
      .set('x-organisation-id', ORG_TWO)
      .set('x-actor-id', PLATFORM_USER)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/organisations/${ORG_TWO}`)
      .set('authorization', `Bearer ${token}`)
      .set('x-role', 'PLATFORM_ADMIN')
      .set('x-organisation-id', ORG_TWO)
      .expect(403);
  });

  it('requires an active membership for organisation login', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: ADMIN_EMAIL, password: PASSWORD, organisationId: ORG_TWO })
      .expect(403);
  });

  it('revokes an existing session immediately when membership is revoked', async () => {
    const token = await login(app, ADMIN_EMAIL, ORG_ONE);
    await request(app.getHttpServer())
      .get(`/organisations/${ORG_ONE}`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);

    await database.query(
      `UPDATE human_organisation_memberships
       SET status='REVOKED',revoked_at=now(),updated_at=now()
       WHERE user_id=$1 AND organisation_id=$2`,
      [ADMIN_USER, ORG_ONE],
    );

    await request(app.getHttpServer())
      .get(`/organisations/${ORG_ONE}`)
      .set('authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('invalidates all sessions when the user auth version changes', async () => {
    const token = await login(app, ADMIN_EMAIL, ORG_ONE);
    await database.query(
      `UPDATE human_users SET auth_version=auth_version+1,updated_at=now() WHERE id=$1`,
      [ADMIN_USER],
    );
    await request(app.getHttpServer()).get('/auth/session').set('authorization', `Bearer ${token}`).expect(401);
  });

  it('supports explicit logout revocation', async () => {
    const token = await login(app, ADMIN_EMAIL, ORG_ONE);
    await request(app.getHttpServer()).post('/auth/logout').set('authorization', `Bearer ${token}`).expect(201);
    await request(app.getHttpServer()).get('/auth/session').set('authorization', `Bearer ${token}`).expect(401);
  });

  it('allows an organisation-neutral platform admin session to create organisations', async () => {
    const token = await login(app, PLATFORM_EMAIL);
    const response = await request(app.getHttpServer())
      .post('/organisations')
      .set('authorization', `Bearer ${token}`)
      .send({ name: 'Platform Created Organisation' })
      .expect(201);
    expect(response.body.name).toBe('Platform Created Organisation');
  });

  it('rejects wrong passwords without revealing whether an account exists', async () => {
    const wrong = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: ADMIN_EMAIL, password: 'definitely-wrong-password', organisationId: ORG_ONE })
      .expect(401);
    const missing = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'missing@example.invalid', password: PASSWORD, organisationId: ORG_ONE })
      .expect(401);
    expect(wrong.body.message).toBe(missing.body.message);
  });
});
