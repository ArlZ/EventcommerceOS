import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../src/database/database.service';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  type ProviderInitiationInput,
  type ProviderInitiationResult,
  type ProviderQueryInput,
  type ProviderQueryResult,
  type ProviderWebhookObservation,
} from '../src/payments/payment-provider';
import { PaymentService } from '../src/payments/payment.service';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

class FakePaymentProvider implements PaymentProvider {
  readonly code = 'MPESA';
  initiationCalls: ProviderInitiationInput[] = [];
  queryCalls: ProviderQueryInput[] = [];
  initiationMode: 'PENDING' | 'TIMEOUT' | 'FAILED' = 'PENDING';
  queryMode: 'SUCCESS' | 'FAILED' | 'PENDING' = 'SUCCESS';
  queryDelayMs = 0;
  queryReceipt = 'TEST-RECEIPT-001';
  fixedRequestId: string | null = null;

  capabilities() {
    return { queryStatus: true, refund: false, reverse: false, webhookVerification: 'NONE' as const };
  }

  async initiate(input: ProviderInitiationInput): Promise<ProviderInitiationResult> {
    this.initiationCalls.push(input);
    if (this.initiationMode === 'TIMEOUT') throw new Error('simulated ambiguous network timeout');
    if (this.initiationMode === 'FAILED') {
      return {
        outcome: 'FAILED',
        providerRequestId: null,
        providerReceiptReference: null,
        reasonCode: 'PROVIDER_REJECTED',
      };
    }
    return {
      outcome: 'ACCEPTED_FOR_PROCESSING',
      providerRequestId: this.fixedRequestId ?? `checkout-${input.attemptId}`,
      providerReceiptReference: null,
      reasonCode: '0',
    };
  }

  async queryStatus(input: ProviderQueryInput): Promise<ProviderQueryResult> {
    this.queryCalls.push(input);
    if (this.queryDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.queryDelayMs));
    }
    return {
      outcome: this.queryMode === 'SUCCESS' ? 'SUCCESS' : this.queryMode,
      providerRequestId: input.providerRequestId,
      providerReceiptReference: this.queryMode === 'SUCCESS' ? this.queryReceipt : null,
      reasonCode: this.queryMode === 'SUCCESS' ? '0' : 'TEST',
    };
  }

  async parseAndVerifyWebhook(): Promise<ProviderWebhookObservation> {
    throw new Error('not used by orchestration tests');
  }
}

function requestInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    eventId: 'payment-event-001',
    orderId: 'payment-order-001',
    paymentId: 'payment-001',
    attemptId: 'attempt-001',
    clientAttemptId: 'client-attempt-001',
    idempotencyKey: 'PAYMENT:payment-order-001:full:client-attempt-001',
    provider: 'MPESA' as const,
    amountMinor: 25_000,
    currency: 'KES',
    payer: { kind: 'MSISDN' as const, value: '254712345678' },
    ...overrides,
  };
}

describeIntegration('payment orchestration', () => {
  let database: DatabaseService;
  let payments: PaymentService;
  let provider: FakePaymentProvider;

  beforeAll(async () => {
    provider = new FakePaymentProvider();
    const moduleRef = await Test.createTestingModule({
      providers: [
        DatabaseService,
        PaymentService,
        { provide: PAYMENT_PROVIDER, useValue: provider },
      ],
    }).compile();
    database = moduleRef.get(DatabaseService);
    payments = moduleRef.get(PaymentService);
  });

  beforeEach(async () => {
    provider.initiationCalls = [];
    provider.queryCalls = [];
    provider.initiationMode = 'PENDING';
    provider.queryMode = 'SUCCESS';
    provider.queryDelayMs = 0;
    provider.queryReceipt = 'TEST-RECEIPT-001';
    provider.fixedRequestId = null;
    await database.query(
      `TRUNCATE payment_reconciliation_exceptions,
       payment_provider_observations,
       payment_attempt_transitions,
       payment_attempt_state,
       payment_attempts,
       payments CASCADE`,
    );
  });

  afterAll(async () => {
    await database.onModuleDestroy();
  });

  it('calls the provider once for repeated and concurrent use of one initiation idempotency key', async () => {
    const input = requestInput();
    const [first, second] = await Promise.all([payments.initiate(input), payments.initiate(input)]);

    expect(provider.initiationCalls).toHaveLength(1);
    expect(first.attempt.attemptId).toBe('attempt-001');
    expect(first.attempt.attemptId).toBe(second.attempt.attemptId);
    expect([first.idempotentReplay, second.idempotentReplay].sort()).toEqual([false, true]);

    const final = await payments.getAttempt(first.attempt.attemptId);
    expect(final.state).toBe('PENDING');
    expect(final.providerRequestId).toBe(`checkout-${final.attemptId}`);
    expect(final.maskedPayerReference).toBe('254****5678');
  });

  it('rejects semantic reuse of one idempotency key without calling the provider again', async () => {
    await payments.initiate(requestInput());
    await expect(
      payments.initiate(requestInput({ amountMinor: 30_000 })),
    ).rejects.toThrow(/idempotency key was reused/);
    expect(provider.initiationCalls).toHaveLength(1);
  });

  it('rejects reuse of one attempt ID under a different idempotency key', async () => {
    provider.initiationMode = 'FAILED';
    await payments.initiate(requestInput());
    await expect(
      payments.initiate(
        requestInput({
          clientAttemptId: 'client-attempt-002',
          idempotencyKey: 'PAYMENT:payment-order-001:full:client-attempt-002',
        }),
      ),
    ).rejects.toThrow(/attempt ID was reused/);
    expect(provider.initiationCalls).toHaveLength(1);
  });

  it('maps an ambiguous provider transport failure to UNKNOWN and blocks a second customer charge', async () => {
    provider.initiationMode = 'TIMEOUT';
    const first = await payments.initiate(requestInput());
    expect(first.attempt.state).toBe('UNKNOWN');
    expect(first.attempt.reconciliationRequired).toBe(true);
    expect(provider.initiationCalls).toHaveLength(1);

    await expect(
      payments.initiate(
        requestInput({
          attemptId: 'attempt-002',
          clientAttemptId: 'client-attempt-002',
          idempotencyKey: 'PAYMENT:payment-order-001:full:client-attempt-002',
        }),
      ),
    ).rejects.toThrow(/unresolved attempt/);
    expect(provider.initiationCalls).toHaveLength(1);

    const exceptions = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM payment_reconciliation_exceptions
       WHERE attempt_id = 'attempt-001' AND exception_type = 'UNKNOWN_WITHOUT_PROVIDER_REQUEST_ID'`,
    );
    expect(exceptions[0]!.count).toBe('1');
  });

  it('allows a new immutable attempt after an explicit provider failure', async () => {
    provider.initiationMode = 'FAILED';
    const failed = await payments.initiate(requestInput());
    expect(failed.attempt.state).toBe('FAILED');

    provider.initiationMode = 'PENDING';
    const retry = await payments.initiate(
      requestInput({
        attemptId: 'attempt-002',
        clientAttemptId: 'client-attempt-002',
        idempotencyKey: 'PAYMENT:payment-order-001:full:client-attempt-002',
      }),
    );
    expect(retry.attempt.attemptId).not.toBe(failed.attempt.attemptId);
    expect(retry.attempt.state).toBe('PENDING');

    const attempts = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM payment_attempts WHERE payment_id = $1',
      ['payment-001'],
    );
    expect(attempts[0]!.count).toBe('2');
  });

  it('resolves a pending attempt through trusted provider query exactly once', async () => {
    const initiated = await payments.initiate(requestInput());
    expect(initiated.attempt.state).toBe('PENDING');

    await payments.reconcileAttempt(initiated.attempt.attemptId, 'query-result-001');
    await payments.reconcileAttempt(initiated.attempt.attemptId, 'query-result-001');

    const final = await payments.getAttempt(initiated.attempt.attemptId);
    expect(final.state).toBe('SUCCESS');
    expect(final.providerReceiptReference).toBe('TEST-RECEIPT-001');
    expect(final.reconciliationRequired).toBe(false);
    expect(provider.queryCalls).toHaveLength(1);

    const transitions = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM payment_attempt_transitions
       WHERE attempt_id = $1 AND to_state = 'SUCCESS'`,
      [initiated.attempt.attemptId],
    );
    expect(transitions[0]!.count).toBe('1');
  });

  it('leases reconciliation so concurrent workers issue one provider status query', async () => {
    const initiated = await payments.initiate(requestInput());
    provider.queryDelayMs = 50;

    await Promise.all([
      payments.reconcileAttempt(initiated.attempt.attemptId, 'worker-query-001'),
      payments.reconcileAttempt(initiated.attempt.attemptId, 'worker-query-002'),
    ]);

    expect(provider.queryCalls).toHaveLength(1);
    expect((await payments.getAttempt(initiated.attempt.attemptId)).state).toBe('SUCCESS');
  });

  it('fails an old attempt that never began provider dispatch so a new attempt can be made safely', async () => {
    await database.query(
      `INSERT INTO payments(id,event_id,order_id,amount_minor,currency)
       VALUES ('payment-001','payment-event-001','payment-order-001',25000,'KES')`,
    );
    await database.query(
      `INSERT INTO payment_attempts(
         id,payment_id,client_attempt_id,provider,amount_minor,currency,
         masked_payer_reference,initiation_idempotency_key,created_at
       ) VALUES (
         'attempt-stale','payment-001','client-stale','MPESA',25000,'KES',
         '254****5678','PAYMENT:payment-order-001:full:client-stale',
         clock_timestamp() - interval '2 minutes'
       )`,
    );
    await database.query(
      `INSERT INTO payment_attempt_state(attempt_id,state,reconciliation_required,updated_at)
       VALUES ('attempt-stale','INITIATED',true,clock_timestamp() - interval '2 minutes')`,
    );

    expect(await payments.failStaleUndispatchedAttempts(30)).toBe(1);
    const stale = await payments.getAttempt('attempt-stale');
    expect(stale.state).toBe('FAILED');
    expect(stale.reconciliationRequired).toBe(false);

    const retry = await payments.initiate(
      requestInput({
        attemptId: 'attempt-002',
        clientAttemptId: 'client-attempt-002',
        idempotencyKey: 'PAYMENT:payment-order-001:full:client-attempt-002',
      }),
    );
    expect(retry.attempt.state).toBe('PENDING');
  });

  it('does not let one provider receipt settle two different payments', async () => {
    const first = await payments.initiate(requestInput());
    provider.queryReceipt = 'SHARED-RECEIPT';
    await payments.reconcileAttempt(first.attempt.attemptId, 'query-first');
    expect((await payments.getAttempt(first.attempt.attemptId)).state).toBe('SUCCESS');

    const second = await payments.initiate(
      requestInput({
        eventId: 'payment-event-002',
        orderId: 'payment-order-002',
        paymentId: 'payment-002',
        attemptId: 'attempt-002',
        clientAttemptId: 'client-attempt-002',
        idempotencyKey: 'PAYMENT:payment-order-002:full:client-attempt-002',
      }),
    );
    await payments.reconcileAttempt(second.attempt.attemptId, 'query-second');

    expect((await payments.getAttempt(second.attempt.attemptId)).state).not.toBe('SUCCESS');
    const exceptions = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM payment_reconciliation_exceptions
       WHERE attempt_id = 'attempt-002' AND exception_type = 'PROVIDER_RECEIPT_REUSED'`,
    );
    expect(exceptions[0]!.count).toBe('1');
  });
});
