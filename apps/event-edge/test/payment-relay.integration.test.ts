import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  InitiatePaymentRequest,
  InitiatePaymentResponse,
  PaymentAttemptSnapshot,
} from '@event-commerce/contracts';
import { EdgeDatabaseService } from '../src/database/database.service';
import { PaymentCloudTransport } from '../src/payments/payment-cloud.transport';
import { PaymentRelayService } from '../src/payments/payment-relay.service';

const describeIntegration = process.env.DATABASE_URL || process.env.EDGE_DATABASE_URL ? describe : describe.skip;

function request(overrides: Partial<InitiatePaymentRequest> = {}): InitiatePaymentRequest {
  return {
    eventId: 'edge-payment-event-001',
    orderId: 'edge-payment-order-001',
    paymentId: 'edge-payment-001',
    attemptId: 'edge-attempt-001',
    clientAttemptId: 'edge-client-attempt-001',
    idempotencyKey: 'PAYMENT:edge-payment-order-001:full:edge-client-attempt-001',
    provider: 'MPESA',
    amountMinor: 25_000,
    currency: 'KES',
    payer: { kind: 'MSISDN', value: '254712345678' },
    ...overrides,
  };
}

function snapshot(input: InitiatePaymentRequest, state: PaymentAttemptSnapshot['state']): PaymentAttemptSnapshot {
  return {
    paymentId: input.paymentId,
    attemptId: input.attemptId,
    clientAttemptId: input.clientAttemptId,
    eventId: input.eventId,
    orderId: input.orderId,
    provider: 'MPESA',
    state,
    amountMinor: input.amountMinor,
    currency: input.currency,
    maskedPayerReference: '254****5678',
    providerRequestId: state === 'UNKNOWN' ? null : `checkout-${input.attemptId}`,
    providerReceiptReference: state === 'SUCCESS' ? `receipt-${input.attemptId}` : null,
    createdAt: '2026-08-14T06:30:00.000Z',
    updatedAt: '2026-08-14T06:30:01.000Z',
    reconciliationRequired: state === 'INITIATED' || state === 'PENDING' || state === 'UNKNOWN',
  };
}

class FakePaymentCloudTransport extends PaymentCloudTransport {
  initiateCalls: InitiatePaymentRequest[] = [];
  getCalls: string[] = [];
  initiateMode: 'PENDING' | 'THROW' = 'PENDING';
  getMode: 'NORMAL' | 'THROW' = 'NORMAL';
  attempts = new Map<string, PaymentAttemptSnapshot>();

  async initiate(input: InitiatePaymentRequest): Promise<InitiatePaymentResponse> {
    this.initiateCalls.push(input);
    if (this.initiateMode === 'THROW') throw new Error('simulated Cloud timeout');
    const attempt = this.attempts.get(input.attemptId) ?? snapshot(input, 'PENDING');
    this.attempts.set(input.attemptId, attempt);
    return { attempt, idempotentReplay: this.initiateCalls.length > 1 };
  }

  async getAttempt(attemptId: string): Promise<PaymentAttemptSnapshot | null> {
    this.getCalls.push(attemptId);
    if (this.getMode === 'THROW') throw new Error('simulated Cloud outage');
    return this.attempts.get(attemptId) ?? null;
  }
}

describeIntegration('Event Edge payment relay', () => {
  let database: EdgeDatabaseService;
  let payments: PaymentRelayService;
  let cloud: FakePaymentCloudTransport;

  beforeAll(async () => {
    cloud = new FakePaymentCloudTransport();
    const moduleRef = await Test.createTestingModule({
      providers: [
        EdgeDatabaseService,
        PaymentRelayService,
        { provide: PaymentCloudTransport, useValue: cloud },
      ],
    }).compile();
    database = moduleRef.get(EdgeDatabaseService);
    payments = moduleRef.get(PaymentRelayService);
  });

  beforeEach(async () => {
    cloud.initiateCalls = [];
    cloud.getCalls = [];
    cloud.initiateMode = 'PENDING';
    cloud.getMode = 'NORMAL';
    cloud.attempts.clear();
    await database.query('TRUNCATE edge_payment_attempts');
  });

  afterAll(async () => {
    await database.onModuleDestroy();
  });

  it('persists UNKNOWN when the first Cloud relay is ambiguous and never stores the raw payer MSISDN', async () => {
    cloud.initiateMode = 'THROW';
    const result = await payments.initiate(request());

    expect(result.attempt.attemptId).toBe('edge-attempt-001');
    expect(result.attempt.state).toBe('UNKNOWN');
    expect(result.attempt.reconciliationRequired).toBe(true);
    expect(result.attempt.maskedPayerReference).toBe('254****5678');

    const rows = await database.query<Record<string, unknown> & { attempt_id: string }>(
      `SELECT * FROM edge_payment_attempts WHERE attempt_id = 'edge-attempt-001'`,
    );
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toContain('254712345678');
    expect(Object.keys(rows[0]!)).not.toContain('payer_msisdn');
  });

  it('replays the same attempt safely after a Cloud timeout and adopts Cloud PENDING truth', async () => {
    cloud.initiateMode = 'THROW';
    const first = await payments.initiate(request());
    expect(first.attempt.state).toBe('UNKNOWN');

    cloud.initiateMode = 'PENDING';
    const second = await payments.initiate(request());
    expect(second.idempotentReplay).toBe(true);
    expect(second.attempt.attemptId).toBe(first.attempt.attemptId);
    expect(second.attempt.state).toBe('PENDING');
    expect(cloud.initiateCalls).toHaveLength(2);
  });

  it('discovers Cloud truth by stable attempt ID after the initial POST response was lost', async () => {
    cloud.initiateMode = 'THROW';
    await payments.initiate(request());
    cloud.attempts.set('edge-attempt-001', snapshot(request(), 'SUCCESS'));

    const refreshed = await payments.getAttempt('edge-attempt-001');
    expect(refreshed.state).toBe('SUCCESS');
    expect(refreshed.providerReceiptReference).toBe('receipt-edge-attempt-001');
    expect(cloud.getCalls).toEqual(['edge-attempt-001']);
  });

  it('preserves known PENDING provider truth during a later Cloud outage', async () => {
    const initiated = await payments.initiate(request());
    expect(initiated.attempt.state).toBe('PENDING');

    cloud.getMode = 'THROW';
    const duringOutage = await payments.getAttempt('edge-attempt-001');
    expect(duringOutage.state).toBe('PENDING');
    expect(duringOutage.reconciliationRequired).toBe(true);

    const relay = await database.query<{ relay_status: string }>(
      `SELECT relay_status FROM edge_payment_attempts WHERE attempt_id = 'edge-attempt-001'`,
    );
    expect(relay[0]!.relay_status).toBe('UNAVAILABLE');
  });

  it('rejects semantic reuse of the idempotency key without replacing the first local attempt', async () => {
    await payments.initiate(request());
    await expect(
      payments.initiate(request({ amountMinor: 30_000 })),
    ).rejects.toThrow(/idempotency key was reused/);
    expect(cloud.initiateCalls).toHaveLength(1);

    const persisted = await payments.getAttempt('edge-attempt-001', false);
    expect(persisted.amountMinor).toBe(25_000);
  });

  it('does not accept a Cloud response whose immutable payment identity differs from Edge', async () => {
    const input = request();
    cloud.attempts.set(input.attemptId, {
      ...snapshot(input, 'PENDING'),
      orderId: 'different-order',
    });

    const result = await payments.initiate(input);
    expect(result.attempt.state).toBe('UNKNOWN');
    expect(result.attempt.providerRequestId).toBeNull();
  });
});
