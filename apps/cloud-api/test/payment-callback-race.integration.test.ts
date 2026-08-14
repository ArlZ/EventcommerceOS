import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseService } from '../src/database/database.service';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  type ProviderInitiationInput,
  type ProviderInitiationResult,
  type ProviderQueryInput,
  type ProviderQueryResult,
  type ProviderWebhookInput,
  type ProviderWebhookObservation,
} from '../src/payments/payment-provider';
import { PaymentService } from '../src/payments/payment.service';
import { PaymentWebhookService } from '../src/payments/payment-webhook.service';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

class CallbackRaceProvider implements PaymentProvider {
  readonly code = 'MPESA';
  initiateCalls = 0;
  queryCalls = 0;
  private startedResolver: (() => void) | null = null;
  private initiationResolver: ((value: ProviderInitiationResult) => void) | null = null;
  readonly started = new Promise<void>((resolve) => {
    this.startedResolver = resolve;
  });

  capabilities() {
    return {
      queryStatus: true,
      refund: false,
      reverse: false,
      webhookVerification: 'CORRELATION_ONLY' as const,
    };
  }

  async initiate(input: ProviderInitiationInput): Promise<ProviderInitiationResult> {
    this.initiateCalls += 1;
    expect(input.attemptId).toBe('attempt-race-001');
    this.startedResolver?.();
    return new Promise<ProviderInitiationResult>((resolve) => {
      this.initiationResolver = resolve;
    });
  }

  releaseInitiation(): void {
    this.initiationResolver?.({
      outcome: 'ACCEPTED_FOR_PROCESSING',
      providerRequestId: 'checkout-race-001',
      providerReceiptReference: null,
      reasonCode: '0',
    });
  }

  async queryStatus(input: ProviderQueryInput): Promise<ProviderQueryResult> {
    this.queryCalls += 1;
    return {
      outcome: 'SUCCESS',
      providerRequestId: input.providerRequestId,
      providerReceiptReference: null,
      reasonCode: '0',
    };
  }

  async parseAndVerifyWebhook(input: ProviderWebhookInput): Promise<ProviderWebhookObservation> {
    expect(input.body).toEqual({ callback: 'early' });
    return {
      observationKey: 'stk:checkout-race-001',
      providerRequestId: 'checkout-race-001',
      outcome: 'SUCCESS',
      providerReceiptReference: 'CALLBACK-RECEIPT',
      reasonCode: '0',
      verificationStrength: 'CORRELATION_ONLY',
      payloadHash: 'early-callback-hash',
      sanitizedDetails: { resultCode: 0 },
    };
  }
}

describeIntegration('M-PESA callback race', () => {
  let database: DatabaseService;
  let payments: PaymentService;
  let webhooks: PaymentWebhookService;
  let provider: CallbackRaceProvider;

  beforeAll(async () => {
    provider = new CallbackRaceProvider();
    const moduleRef = await Test.createTestingModule({
      providers: [
        DatabaseService,
        PaymentService,
        PaymentWebhookService,
        { provide: PAYMENT_PROVIDER, useValue: provider },
      ],
    }).compile();
    database = moduleRef.get(DatabaseService);
    payments = moduleRef.get(PaymentService);
    webhooks = moduleRef.get(PaymentWebhookService);
  });

  beforeEach(async () => {
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

  it('does not lose or trust a callback that arrives before initiation returns', async () => {
    const initiation = payments.initiate({
      eventId: 'event-race-001',
      orderId: 'order-race-001',
      paymentId: 'payment-race-001',
      attemptId: 'attempt-race-001',
      clientAttemptId: 'client-race-001',
      idempotencyKey: 'PAYMENT:order-race-001:full:client-race-001',
      provider: 'MPESA',
      amountMinor: 25_000,
      currency: 'KES',
      payer: { kind: 'MSISDN', value: '254712345678' },
    });

    await provider.started;
    const early = await webhooks.ingest({
      headers: {},
      body: { callback: 'early' },
      receivedAt: '2026-08-14T07:20:00.000Z',
    });
    expect(early).toEqual({
      duplicate: false,
      correlatedAttemptId: null,
      reconciliationRequested: false,
    });

    provider.releaseInitiation();
    const initiated = await initiation;
    expect(initiated.attempt.state).toBe('PENDING');
    expect(initiated.attempt.providerRequestId).toBe('checkout-race-001');
    expect(provider.initiateCalls).toBe(1);

    const callbackEvidence = await database.query<{
      attempt_id: string | null;
      provider_receipt_reference: string | null;
    }>(
      `SELECT attempt_id,provider_receipt_reference
       FROM payment_provider_observations
       WHERE provider = 'MPESA' AND observation_key = 'stk:checkout-race-001'`,
    );
    expect(callbackEvidence[0]).toEqual({
      attempt_id: 'attempt-race-001',
      provider_receipt_reference: 'CALLBACK-RECEIPT',
    });
    expect(initiated.attempt.providerReceiptReference).toBeNull();

    const unknownCallback = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM payment_reconciliation_exceptions
       WHERE exception_type = 'UNKNOWN_PROVIDER_REQUEST_ID'`,
    );
    expect(unknownCallback[0]!.count).toBe('1');

    await payments.reconcileAttempt('attempt-race-001', 'query-after-early-callback');
    const final = await payments.getAttempt('attempt-race-001');
    expect(final.state).toBe('SUCCESS');
    expect(final.providerReceiptReference).toBeNull();
    expect(final.reconciliationRequired).toBe(false);
    expect(provider.queryCalls).toBe(1);
    expect(provider.initiateCalls).toBe(1);
  });
});
