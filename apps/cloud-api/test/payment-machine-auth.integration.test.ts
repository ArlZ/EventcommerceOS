import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { DEFAULT_SYNC_EVENT_ID, provisionSyncEdge } from './sync-auth-testkit';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;
const OTHER_ORG_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_EVENT_ID = '44444444-4444-4444-8444-444444444444';

function paymentRequest(eventId = DEFAULT_SYNC_EVENT_ID) {
  return {
    eventId,
    paymentId: `payment-${eventId}`,
    paymentAttemptId: `attempt-${eventId}`,
    orderId: `order-${eventId}`,
    providerId: 'external_terminal',
    idempotencyKey: `PAYMENT:${eventId}:primary:client-1`,
    amountMinor: 15000,
    currency: 'KES',
    accountReference: `attempt-${eventId}`,
  };
}

function applyHeaders(call: request.Test, headers: Record<string, string>): request.Test {
  let result = call;
  for (const [key, value] of Object.entries(headers)) result = result.set(key, value);
  return result;
}

describeIntegration('Cloud payment machine authentication', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let primaryHeaders: Record<string, string>;
  let otherHeaders: Record<string, string>;

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
         payment_audit_events,
         payment_manual_terminal_confirmations,
         payment_actor_permissions,
         payment_provider_events,
         payment_reconciliation_jobs,
         payment_refunds,
         payment_reversals,
         payment_attempts,
         payments,
         edge_sync_client_audit,
         edge_sync_clients
       CASCADE`,
    );
    primaryHeaders = (
      await provisionSyncEdge(database, {
        edgeId: 'edge-payment-primary',
        eventIds: [DEFAULT_SYNC_EVENT_ID],
      })
    ).headers;
    otherHeaders = (
      await provisionSyncEdge(database, {
        edgeId: 'edge-payment-other',
        organisationId: OTHER_ORG_ID,
        eventIds: [OTHER_EVENT_ID],
      })
    ).headers;
  });

  afterAll(async () => {
    delete process.env.PAYMENT_RECONCILIATION_DISABLED;
    await app.close();
  });

  it('rejects unauthenticated machine payment initiation before durable payment effect', async () => {
    await request(app.getHttpServer())
      .post('/payments/initiate')
      .send(paymentRequest())
      .expect(401);
    const rows = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM payments',
    );
    expect(rows[0]?.count).toBe('0');
  });

  it('accepts tenant-bound Edge initiation and protects order reads from another Edge organisation', async () => {
    const initiated = await applyHeaders(
      request(app.getHttpServer()).post('/payments/initiate'),
      primaryHeaders,
    )
      .send(paymentRequest())
      .expect(201);
    expect(initiated.body.status).toBe('PENDING');

    await applyHeaders(
      request(app.getHttpServer()).get(`/payments/orders/${paymentRequest().orderId}`),
      primaryHeaders,
    ).expect(200);

    await applyHeaders(
      request(app.getHttpServer()).get(`/payments/orders/${paymentRequest().orderId}`),
      otherHeaders,
    ).expect(401);
  });

  it('rejects initiation for an event outside the authenticated Edge organisation', async () => {
    await applyHeaders(request(app.getHttpServer()).post('/payments/initiate'), primaryHeaders)
      .send(paymentRequest(OTHER_EVENT_ID))
      .expect(401);
  });

  it('requires an active Edge credential for payment rail availability', async () => {
    await request(app.getHttpServer()).get('/payments/providers/availability').expect(401);
    const response = await applyHeaders(
      request(app.getHttpServer()).get('/payments/providers/availability'),
      primaryHeaders,
    ).expect(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  it('authorizes reconciliation only to the payment tenant', async () => {
    await applyHeaders(request(app.getHttpServer()).post('/payments/initiate'), primaryHeaders)
      .send(paymentRequest())
      .expect(201);

    await applyHeaders(
      request(app.getHttpServer()).post(
        `/payments/attempts/${paymentRequest().paymentAttemptId}/reconcile`,
      ),
      otherHeaders,
    ).expect(401);

    await applyHeaders(
      request(app.getHttpServer()).post(
        `/payments/attempts/${paymentRequest().paymentAttemptId}/reconcile`,
      ),
      primaryHeaders,
    ).expect(201);
  });

  it.each([
    ['POST', '/payments/manual-terminal-confirmations'],
    ['POST', '/payments/refunds'],
    ['POST', '/payments/reversals'],
    ['GET', '/payments/payment-locked/history'],
    ['GET', '/payments/payment-locked/manual-terminal-confirmations'],
    ['GET', `/payments/events/${DEFAULT_SYNC_EVENT_ID}/health`],
  ])('fails privileged human payment route closed: %s %s', async (method, path) => {
    const call =
      method === 'GET'
        ? request(app.getHttpServer()).get(path)
        : request(app.getHttpServer()).post(path).send({});
    await applyHeaders(call, primaryHeaders).expect(403);
  });
});
