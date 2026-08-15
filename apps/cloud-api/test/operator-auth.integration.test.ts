import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import {
  provisionOperator,
  revokeOperatorIdentity,
  revokeOperatorSession,
} from './operator-auth-testkit';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration('operator authentication and server-derived RBAC', () => {
  let app: INestApplication;
  let database: DatabaseService;
  const organisationId = randomUUID();
  const otherOrganisationId = randomUUID();
  const eventId = randomUUID();

  beforeAll(async () => {
    process.env.PAYMENT_RECONCILIATION_DISABLED = 'true';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    database = moduleRef.get(DatabaseService);
    await app.init();

    await database.query(
      `INSERT INTO organisations(id,name) VALUES ($1,'Operator auth org'),($2,'Other auth org')
       ON CONFLICT (id) DO NOTHING`,
      [organisationId, otherOrganisationId],
    );
    await database.query(
      `INSERT INTO events(id,organisation_id,name,timezone,lifecycle,starts_at,ends_at)
       VALUES ($1,$2,'Operator auth event','Africa/Nairobi','ACTIVE',now()-interval '1 hour',now()+interval '4 hours')
       ON CONFLICT (id) DO NOTHING`,
      [eventId, organisationId],
    );
  });

  afterAll(async () => {
    delete process.env.PAYMENT_RECONCILIATION_DISABLED;
    await app.close();
  });

  it('rejects spoofed legacy actor and role headers without an operator session', async () => {
    await request(app.getHttpServer())
      .get(`/organisations/${organisationId}/configuration`)
      .set({
        'x-actor-id': randomUUID(),
        'x-role': 'PLATFORM_ADMIN',
        'x-organisation-id': organisationId,
      })
      .expect(401);
  });

  it('does not let a VIEWER inflate its role with x-role', async () => {
    const actorId = randomUUID();
    const viewer = await provisionOperator(database, {
      actorId,
      memberships: [{ organisationId, role: 'VIEWER' }],
    });

    await request(app.getHttpServer())
      .get(`/organisations/${organisationId}/configuration`)
      .set({
        ...viewer.headers(organisationId),
        'x-actor-id': actorId,
        'x-role': 'PLATFORM_ADMIN',
      })
      .expect(403);

    await request(app.getHttpServer())
      .get(`/inventory/events/${eventId}/operations`)
      .set(viewer.headers(organisationId))
      .expect(200);
  });

  it('rejects organisation selection without an active membership', async () => {
    const actorId = randomUUID();
    const admin = await provisionOperator(database, {
      actorId,
      memberships: [{ organisationId, role: 'ADMIN' }],
    });

    await request(app.getHttpServer())
      .get(`/organisations/${otherOrganisationId}/configuration`)
      .set(admin.headers(otherOrganisationId))
      .expect(403);
  });

  it('reserves organisation creation for PLATFORM_ADMIN', async () => {
    const adminActorId = randomUUID();
    const admin = await provisionOperator(database, {
      actorId: adminActorId,
      memberships: [{ organisationId, role: 'ADMIN' }],
    });
    await request(app.getHttpServer())
      .post('/organisations')
      .set(admin.headers())
      .send({ name: `Forbidden org ${randomUUID()}` })
      .expect(403);

    const platform = await provisionOperator(database, {
      actorId: randomUUID(),
      platformAdmin: true,
    });
    await request(app.getHttpServer())
      .post('/organisations')
      .set(platform.headers())
      .send({ name: `Platform org ${randomUUID()}` })
      .expect(201);
  });

  it('rejects revoked and expired sessions', async () => {
    const revokedActor = randomUUID();
    const revoked = await provisionOperator(database, {
      actorId: revokedActor,
      memberships: [{ organisationId, role: 'ADMIN' }],
    });
    await revokeOperatorSession(database, revoked.token);
    await request(app.getHttpServer())
      .get(`/organisations/${organisationId}/configuration`)
      .set(revoked.headers(organisationId))
      .expect(401);

    const expiredActor = randomUUID();
    const expired = await provisionOperator(database, {
      actorId: expiredActor,
      memberships: [{ organisationId, role: 'ADMIN' }],
    });
    await database.query(
      `UPDATE operator_sessions
       SET created_at=now()-interval '2 minutes',expires_at=now()-interval '1 minute'
       WHERE actor_id=$1 AND revoked_at IS NULL`,
      [expiredActor],
    );
    await request(app.getHttpServer())
      .get(`/organisations/${organisationId}/configuration`)
      .set(expired.headers(organisationId))
      .expect(401);
  });

  it('rejects sessions after the operator identity is revoked', async () => {
    const actorId = randomUUID();
    const operator = await provisionOperator(database, {
      actorId,
      memberships: [{ organisationId, role: 'ADMIN' }],
    });
    await revokeOperatorIdentity(database, actorId);
    await request(app.getHttpServer())
      .get(`/organisations/${organisationId}/configuration`)
      .set(operator.headers(organisationId))
      .expect(401);
  });

  it('does not accept an Event Edge machine credential as a human admin session', async () => {
    await request(app.getHttpServer())
      .get(`/organisations/${organisationId}/configuration`)
      .set({
        authorization: `Bearer ${'edge-machine-token-'.padEnd(48, 'x')}`,
        'x-edge-id': 'edge-auth-test',
        'x-organisation-id': organisationId,
        'x-role': 'ADMIN',
        'x-actor-id': randomUUID(),
      })
      .expect(401);
  });

  it('allows FINANCE payment health but denies configuration authority', async () => {
    const finance = await provisionOperator(database, {
      actorId: randomUUID(),
      memberships: [{ organisationId, role: 'FINANCE' }],
    });

    await request(app.getHttpServer())
      .get(`/payments/events/${eventId}/health`)
      .set(finance.headers(organisationId))
      .expect(200);
    await request(app.getHttpServer())
      .get(`/organisations/${organisationId}/configuration`)
      .set(finance.headers(organisationId))
      .expect(403);
  });

  it('does not let an organisation ADMIN create a refund or reversal', async () => {
    const actorId = randomUUID();
    const admin = await provisionOperator(database, {
      actorId,
      memberships: [{ organisationId, role: 'ADMIN' }],
    });
    const paymentId = `payment-admin-denied-${randomUUID()}`;
    await database.query(
      `INSERT INTO payments(id,event_id,order_id,amount_minor,currency)
       VALUES ($1,$2,$3,10000,'KES')`,
      [paymentId, eventId, `order-${randomUUID()}`],
    );

    await request(app.getHttpServer())
      .post('/payments/refunds')
      .set(admin.headers(organisationId))
      .send({
        refundId: `refund-${randomUUID()}`,
        paymentId,
        amountMinor: 1000,
        currency: 'KES',
        reason: 'Should require finance authority',
        requestingActorId: actorId,
        idempotencyKey: `refund-idem-${randomUUID()}`,
      })
      .expect(403);

    await request(app.getHttpServer())
      .post('/payments/reversals')
      .set(admin.headers(organisationId))
      .send({
        reversalId: `reversal-${randomUUID()}`,
        paymentId,
        amountMinor: 1000,
        currency: 'KES',
        reason: 'Should require finance authority',
        requestingActorId: actorId,
        idempotencyKey: `reversal-idem-${randomUUID()}`,
      })
      .expect(403);

    const rows = await database.query<{ refunds: string; reversals: string }>(
      `SELECT
         (SELECT count(*)::text FROM payment_refunds WHERE payment_id=$1) AS refunds,
         (SELECT count(*)::text FROM payment_reversals WHERE payment_id=$1) AS reversals`,
      [paymentId],
    );
    expect(rows[0]).toEqual({ refunds: '0', reversals: '0' });
  });

  it('rejects a privileged payment body that names a different actor before business effect', async () => {
    const actorId = randomUUID();
    const supervisor = await provisionOperator(database, {
      actorId,
      memberships: [{ organisationId, role: 'SUPERVISOR' }],
    });
    const paymentId = `payment-${randomUUID()}`;
    const attemptId = `attempt-${randomUUID()}`;
    await database.query(
      `INSERT INTO payments(id,event_id,order_id,amount_minor,currency)
       VALUES ($1,$2,$3,10000,'KES')`,
      [paymentId, eventId, `order-${randomUUID()}`],
    );
    await database.query(
      `INSERT INTO payment_attempts(
         id,payment_id,provider_id,idempotency_key,status,request_fingerprint
       ) VALUES ($1,$2,'external_terminal',$3,'PENDING',$4)`,
      [attemptId, paymentId, `idem-${randomUUID()}`, `fingerprint-${randomUUID()}`],
    );

    await request(app.getHttpServer())
      .post('/payments/manual-terminal-confirmations')
      .set(supervisor.headers(organisationId))
      .send({
        confirmationId: `confirmation-${randomUUID()}`,
        paymentAttemptId: attemptId,
        externalProviderId: 'external_terminal',
        externalReference: `terminal-${randomUUID()}`,
        amountMinor: 10000,
        currency: 'KES',
        outcome: 'APPROVED',
        actorId: randomUUID(),
        reason: 'supervised terminal confirmation',
        idempotencyKey: `confirm-${randomUUID()}`,
      })
      .expect(403);

    const rows = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM payment_manual_terminal_confirmations
       WHERE payment_attempt_id=$1`,
      [attemptId],
    );
    expect(rows[0]!.count).toBe('0');
  });
});
