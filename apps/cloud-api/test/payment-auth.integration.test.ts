import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { OperatorAuthService } from '../src/auth/operator-auth.service';
import { DatabaseService } from '../src/database/database.service';
import { ManualTerminalService } from '../src/payments/manual-terminal.service';
import { PaymentAdjustmentsService } from '../src/payments/payment-adjustments.service';
import { PaymentRailService } from '../src/payments/payment-rail.service';
import { PaymentsService } from '../src/payments/payments.service';
import {
  enableOperatorTestSigningKey,
  operatorHeaders,
  operatorToken,
  provisionOperator,
} from './operator-auth-testkit';
import { provisionSyncEdge, syncEdgeHeaders } from './sync-auth-testkit';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;
const organisationId = '71111111-1111-4111-8111-111111111111';
const otherOrganisationId = '71111111-1111-4111-8111-222222222222';
const eventId = '72222222-2222-4222-8222-111111111111';
const otherEventId = '72222222-2222-4222-8222-222222222222';
const edgeId = 'payment-auth-edge';
const otherEdgeId = 'payment-auth-other-edge';
const edgeToken = 'payment-auth-edge-token-0123456789-abcdefghijklmnopqrstuvwxyz';
const otherEdgeToken = 'payment-auth-other-edge-token-0123456789-abcdefghijklmnopqrstuvwxyz';
const operatorActor = '73333333-3333-4333-8333-111111111111';
const supervisorActor = '73333333-3333-4333-8333-222222222222';
const approverActor = '73333333-3333-4333-8333-333333333333';
const otherOrgSupervisor = '73333333-3333-4333-8333-444444444444';
const adminActor = '73333333-3333-4333-8333-555555555555';

function paymentView(status = 'PENDING') {
  return {
    eventId,
    paymentId: 'payment-auth-1',
    paymentAttemptId: 'attempt-auth-1',
    orderId: 'order-auth-1',
    providerId: 'fake',
    amountMinor: 10000,
    currency: 'KES',
    status,
    providerReference: 'provider-auth-1',
    failureCode: null,
    reconciliationRequired: status === 'UNKNOWN',
    createdAt: '2026-08-14T12:00:00.000Z',
    updatedAt: '2026-08-14T12:00:00.000Z',
  };
}

function initiateBody(targetEventId = eventId) {
  return {
    eventId: targetEventId,
    paymentId: 'payment-http-new',
    paymentAttemptId: 'attempt-http-new',
    orderId: 'order-http-new',
    providerId: 'fake',
    idempotencyKey: 'payment-http-idem',
    amountMinor: 10000,
    currency: 'KES',
    accountReference: 'ORDER-HTTP',
  };
}

function manualBody(actorId = supervisorActor) {
  return {
    confirmationId: 'manual-auth-1',
    paymentAttemptId: 'attempt-auth-1',
    externalProviderId: 'external_terminal',
    externalReference: 'manual-ref-1',
    amountMinor: 10000,
    currency: 'KES',
    outcome: 'APPROVED',
    actorId,
    reason: 'Terminal approved',
    idempotencyKey: 'manual-auth-idem',
  };
}

function refundBody(requestingActorId = supervisorActor, approvingActorId?: string) {
  return {
    refundId: 'refund-auth-1',
    paymentId: 'payment-auth-1',
    amountMinor: 2000,
    currency: 'KES',
    reason: 'Customer refund',
    requestingActorId,
    ...(approvingActorId === undefined ? {} : { approvingActorId }),
    idempotencyKey: 'refund-auth-idem',
  };
}

function reversalBody(requestingActorId = adminActor) {
  return {
    reversalId: 'reversal-auth-1',
    paymentId: 'payment-auth-1',
    amountMinor: 10000,
    currency: 'KES',
    reason: 'Administrative reversal',
    requestingActorId,
    idempotencyKey: 'reversal-auth-idem',
  };
}

describeIntegration('Cloud payment authorization', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let auth: OperatorAuthService;
  const payments = {
    initiate: vi.fn(async () => paymentView()),
    reconcileAttempt: vi.fn(async () => paymentView('SUCCEEDED')),
    ingestProviderCallback: vi.fn(async () => ({ received: true })),
    byOrder: vi.fn(async () => [paymentView()]),
    health: vi.fn(async () => ({ eventId, unknownCount: 0 })),
  };
  const adjustments = {
    refund: vi.fn(async (input: unknown) => ({ status: 'SUCCEEDED', input })),
    reverse: vi.fn(async (input: unknown) => ({ status: 'SUCCEEDED', input })),
    history: vi.fn(async () => ({ paymentId: 'payment-auth-1', refunds: [], reversals: [] })),
  };
  const manualTerminal = {
    confirm: vi.fn(async (input: unknown) => ({ confirmationId: 'manual-auth-1', input })),
    history: vi.fn(async () => []),
  };
  const rails = {
    availability: vi.fn(async () => [{ providerId: 'fake', status: 'AVAILABLE', detailCode: null }]),
  };

  beforeAll(async () => {
    process.env.PAYMENT_RECONCILIATION_DISABLED = 'true';
    enableOperatorTestSigningKey();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PaymentsService)
      .useValue(payments)
      .overrideProvider(PaymentAdjustmentsService)
      .useValue(adjustments)
      .overrideProvider(ManualTerminalService)
      .useValue(manualTerminal)
      .overrideProvider(PaymentRailService)
      .useValue(rails)
      .compile();
    app = moduleRef.createNestApplication();
    database = moduleRef.get(DatabaseService);
    auth = moduleRef.get(OperatorAuthService);
    await app.init();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await database.query(
      `TRUNCATE
         payment_actor_permissions,
         payment_provider_events,
         payment_reconciliation_jobs,
         payment_refunds,
         payment_reversals,
         payment_attempts,
         payments,
         edge_sync_client_audit,
         edge_sync_clients,
         operator_account_audit,
         operator_accounts,
         events,
         organisations
       CASCADE`,
    );
    await provisionSyncEdge(database, {
      edgeId,
      organisationId,
      eventIds: [eventId],
      token: edgeToken,
    });
    await provisionSyncEdge(database, {
      edgeId: otherEdgeId,
      organisationId: otherOrganisationId,
      eventIds: [otherEventId],
      token: otherEdgeToken,
    });
    await database.query(
      `INSERT INTO payments(id,event_id,order_id,amount_minor,currency)
       VALUES ('payment-auth-1',$1,'order-auth-1',10000,'KES')`,
      [eventId],
    );
    await database.query(
      `INSERT INTO payment_attempts(
         id,payment_id,provider_id,idempotency_key,status,request_fingerprint
       ) VALUES ('attempt-auth-1','payment-auth-1','fake','attempt-auth-idem','UNKNOWN','auth-fingerprint')`,
    );

    await provisionOperator(database, {
      actorId: operatorActor,
      organisationId,
      role: 'OPERATOR',
    });
    await provisionOperator(database, {
      actorId: supervisorActor,
      organisationId,
      role: 'SUPERVISOR',
      permissions: [
        { eventId, permission: 'PAYMENT_MANUAL_CONFIRM' },
        { eventId, permission: 'PAYMENT_REFUND' },
        { eventId, permission: 'PAYMENT_VIEW' },
      ],
    });
    await provisionOperator(database, {
      actorId: approverActor,
      organisationId,
      role: 'SUPERVISOR',
      permissions: [{ eventId, permission: 'PAYMENT_REFUND' }],
    });
    await provisionOperator(database, {
      actorId: otherOrgSupervisor,
      organisationId: otherOrganisationId,
      role: 'SUPERVISOR',
      permissions: [],
    });
    await provisionOperator(database, {
      actorId: adminActor,
      organisationId,
      role: 'ADMIN',
    });
  });

  afterAll(async () => {
    delete process.env.PAYMENT_RECONCILIATION_DISABLED;
    delete process.env.OPERATOR_TOKEN_SIGNING_PRIVATE_KEY;
    delete process.env.OPERATOR_TOKEN_VERIFYING_PUBLIC_KEY;
    delete process.env.OPERATOR_ACCESS_TOKEN_TTL_SECONDS;
    await app.close();
  });

  it('requires a valid Event Edge machine identity for payment initiation', async () => {
    await request(app.getHttpServer()).post('/payments/initiate').send(initiateBody()).expect(401);
    await request(app.getHttpServer())
      .post('/payments/initiate')
      .set(syncEdgeHeaders(otherEdgeId, otherEdgeToken))
      .send(initiateBody())
      .expect(401);
    expect(payments.initiate).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .post('/payments/initiate')
      .set(syncEdgeHeaders(edgeId, edgeToken))
      .send(initiateBody())
      .expect(201);
    expect(payments.initiate).toHaveBeenCalledTimes(1);
  });

  it('uses Event Edge machine auth for reconciliation, order history and rail availability', async () => {
    await request(app.getHttpServer())
      .post('/payments/attempts/attempt-auth-1/reconcile')
      .set(syncEdgeHeaders(otherEdgeId, otherEdgeToken))
      .send({})
      .expect(401);
    await request(app.getHttpServer())
      .post('/payments/attempts/attempt-auth-1/reconcile')
      .set(syncEdgeHeaders(edgeId, edgeToken))
      .send({})
      .expect(201);
    expect(payments.reconcileAttempt).toHaveBeenCalledWith('attempt-auth-1');

    await request(app.getHttpServer())
      .get('/payments/orders/order-auth-1')
      .set(syncEdgeHeaders(edgeId, edgeToken))
      .expect(200);
    expect(payments.byOrder).toHaveBeenCalledWith('order-auth-1');

    await request(app.getHttpServer())
      .get('/payments/providers/availability')
      .set(syncEdgeHeaders(edgeId, edgeToken))
      .expect(200);
    expect(rails.availability).toHaveBeenCalledTimes(1);
  });

  it('requires signed supervisor permission and signed actor identity for manual terminal truth', async () => {
    await request(app.getHttpServer())
      .post('/payments/manual-terminal-confirmations')
      .send(manualBody())
      .expect(401);

    await request(app.getHttpServer())
      .post('/payments/manual-terminal-confirmations')
      .set(await operatorHeaders(auth, operatorActor))
      .send(manualBody(operatorActor))
      .expect(403);

    await request(app.getHttpServer())
      .post('/payments/manual-terminal-confirmations')
      .set(await operatorHeaders(auth, supervisorActor))
      .send(manualBody(approverActor))
      .expect(403);
    expect(manualTerminal.confirm).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .post('/payments/manual-terminal-confirmations')
      .set(await operatorHeaders(auth, supervisorActor))
      .send(manualBody(supervisorActor))
      .expect(201);
    expect(manualTerminal.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: supervisorActor }),
    );
  });

  it('requires two distinct signed authorized operators for every refund', async () => {
    const requestorHeaders = await operatorHeaders(auth, supervisorActor);
    const sameActorToken = await operatorToken(auth, supervisorActor);
    await request(app.getHttpServer())
      .post('/payments/refunds')
      .set({ ...requestorHeaders, 'x-approval-token': sameActorToken })
      .send(refundBody(supervisorActor, supervisorActor))
      .expect(403);

    const wrongOrgToken = await operatorToken(auth, otherOrgSupervisor);
    await request(app.getHttpServer())
      .post('/payments/refunds')
      .set({ ...requestorHeaders, 'x-approval-token': wrongOrgToken })
      .send(refundBody(supervisorActor, otherOrgSupervisor))
      .expect(403);
    expect(adjustments.refund).not.toHaveBeenCalled();

    const approverToken = await operatorToken(auth, approverActor);
    await request(app.getHttpServer())
      .post('/payments/refunds')
      .set({ ...requestorHeaders, 'x-approval-token': approverToken })
      .send(refundBody(supervisorActor, approverActor))
      .expect(201);
    expect(adjustments.refund).toHaveBeenCalledWith(
      expect.objectContaining({
        requestingActorId: supervisorActor,
        approvingActorId: approverActor,
      }),
    );
  });

  it('limits reversal to authenticated administrators and derives the actor from the token', async () => {
    await request(app.getHttpServer())
      .post('/payments/reversals')
      .set(await operatorHeaders(auth, supervisorActor))
      .send(reversalBody(supervisorActor))
      .expect(403);
    expect(adjustments.reverse).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .post('/payments/reversals')
      .set(await operatorHeaders(auth, adminActor))
      .send(reversalBody(adminActor))
      .expect(201);
    expect(adjustments.reverse).toHaveBeenCalledWith(
      expect.objectContaining({ requestingActorId: adminActor }),
    );
  });

  it('protects sensitive payment history and event health with PAYMENT_VIEW', async () => {
    await request(app.getHttpServer())
      .get('/payments/payment-auth-1/history')
      .set(await operatorHeaders(auth, operatorActor))
      .expect(403);
    await request(app.getHttpServer())
      .get('/payments/payment-auth-1/history')
      .set(await operatorHeaders(auth, supervisorActor))
      .expect(200);
    expect(adjustments.history).toHaveBeenCalledWith('payment-auth-1');

    await request(app.getHttpServer())
      .get(`/payments/events/${eventId}/health`)
      .set(await operatorHeaders(auth, supervisorActor))
      .expect(200);
    expect(payments.health).toHaveBeenCalledWith(eventId);
  });
});
