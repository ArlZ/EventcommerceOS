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
      providerRequestId: `checkout-${input.attemptId}`,
      providerReceiptReference: null,
      reasonCode: '0',
    };
  }

  async queryStatus(input: ProviderQueryInput): Promise<ProviderQueryResult> {
    this.queryCalls.push(input);
    return {
      outcome: this.queryMode === 'SUCCESS' ? 'SUCCESS' : this.queryMode,
      providerRequestId: input.providerRequestId,
      providerReceiptReference: this.queryMode === 'SUCCESS' ? 'TEST-RECEIPT-001' : null,
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
    expect(first.attempt.attemptId).toBe(second.attempt.attemptId);
    expect([first.idempotentReplay, second.idempotentReplay].sort()).toEqual([false, true]);

    const final = await payments.getAttempt(first.attempt.attemptId);
    expect(final.state).toBe('PENDING');
    expect(final.providerRequestId).toBe(`checkout-${final.attemptId}`);
    expect(final.maskedPayerReference).toBe('254****5678');
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
          clientAttemptId: 'client-attempt-002',
          idempotencyKey: 'PAYMENT:payment-order-001:full:client-attempt-002',
        }),
      ),
    ).rejects.toThrow(/unresolved attempt/);
    expect(provider.initiationCalls).toHaveLength(1);
  });

  it('allows a new immutable attempt after an explicit provider failure', async () => {
    provider.initiationMode = 'FAILED';
    const failed = await payments.initiate(requestInput());
    expect(failed.attempt.state).toBe('FAILED');

    provider.initiationMode = 'PENDING';
    const retry = await payments.initiate(
      requestInput({
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
});
