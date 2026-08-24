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

describeIntegration('operator session introspection', () => {
  let app: INestApplication;
  let database: DatabaseService;
  const organisationId = randomUUID();

  beforeAll(async () => {
    process.env.PAYMENT_RECONCILIATION_DISABLED = 'true';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    database = moduleRef.get(DatabaseService);
    await app.init();
    await database.query(
      `INSERT INTO organisations(id,name) VALUES ($1,'Session profile organisation')
       ON CONFLICT (id) DO NOTHING`,
      [organisationId],
    );
  });

  afterAll(async () => {
    delete process.env.PAYMENT_RECONCILIATION_DISABLED;
    await app.close();
  });

  it('returns only the authenticated operator profile and active organisation memberships', async () => {
    const actorId = randomUUID();
    const operator = await provisionOperator(database, {
      actorId,
      displayName: 'Pilot Operations Lead',
      memberships: [{ organisationId, role: 'ADMIN' }],
      expiresInMinutes: 60,
    });

    const response = await request(app.getHttpServer())
      .get('/auth/operator/session')
      .set(operator.headers())
      .expect(200);

    expect(response.body).toMatchObject({
      actorId,
      displayName: 'Pilot Operations Lead',
      platformAdmin: false,
      memberships: [
        {
          organisationId,
          organisationName: 'Session profile organisation',
          role: 'ADMIN',
        },
      ],
    });
    expect(Date.parse(response.body.expiresAt as string)).toBeGreaterThan(Date.now());
    expect(JSON.stringify(response.body)).not.toContain(operator.token);
    expect(response.body).not.toHaveProperty('sessionId');
  });

  it('rejects a revoked operator session instead of returning stale profile data', async () => {
    const actorId = randomUUID();
    const operator = await provisionOperator(database, {
      actorId,
      memberships: [{ organisationId, role: 'VIEWER' }],
    });
    await revokeOperatorSession(database, operator.token);

    await request(app.getHttpServer()).get('/auth/operator/session').set(operator.headers()).expect(401);
  });
});
