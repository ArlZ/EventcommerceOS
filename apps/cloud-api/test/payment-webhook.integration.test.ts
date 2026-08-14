import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseService } from '../src/database/database.service';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  type ProviderInitiationResult,
  type ProviderQueryResult,
  type ProviderWebhookObservation,
} from '../src/payments/payment-provider';
import { PaymentWebhookService } from '../src/payments/payment-webhook.service';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

class WebhookProvider implements PaymentProvider {
  readonly code = 'MPESA';
  observation: ProviderWebhookObservation = {
    observationKey: 'webhook-observation-001',
    providerRequestId: 'checkout-request-001',
    outcome: 'SUCCESS',
    providerReceiptReference: 'RECEIPT-001',
    reasonCode: '0',
    verificationStrength: 'CORRELATION_ONLY',
    payloadHash: 'hash-001',
    sanitizedDetails: { resultCode: 0 },
  };

  capabilities() {
    return {
      queryStatus: true,
      refund: false,
      reverse: false,
      webhookVerification: 'CORRELATION_ONLY' as const,
    };
  }

  async initiate(): Promise<ProviderInitiationResult> {
    throw new Error('not used');
  }

  async queryStatus(): Promise<ProviderQueryResult> {
    throw new Error('not used');
  }

  async parseAndVerifyWebhook(): Promise<ProviderWebhookObservation> {
    return this.observation;
  }
}

describeIntegration('payment webhook trust boundary', () => {
  let database: DatabaseService;
  let webhooks: PaymentWebhookService;
  let provider: WebhookProvider;

  beforeAll(async () => {
    provider = new WebhookProvider();
    const moduleRef = await Test.createTestingModule({
      providers: [
        DatabaseService,
        PaymentWebhookService,
        { provide: PAYMENT_PROVIDER, useValue: provider },
      ],
    }).compile();
    database = moduleRef.get(DatabaseService);
    webhooks = moduleRef.get(PaymentWebhookService);
  });

  beforeEach(async () => {
    provider.observation = {
      observationKey: 'webhook-observation-001',
      providerRequestId: 'checkout-request-001',
      outcome: 'SUCCESS',
      providerReceiptReference: 'RECEIPT-001',
      reasonCode: '0',
      verificationStrength: 'CORRELATION_ONLY',
      payloadHash: 'hash-001',
      sanitizedDetails: { resultCode: 0 },
    };
    await database.query(
      `TRUNCATE payment_reconciliation_exceptions,
       payment_provider_observations,
       payment_attempt_transitions,
       payment_attempt_state,
       payment_attempts,
       payments CASCADE`,
    );
    await database.query(
      `INSERT INTO payments(id,event_id,order_id,amount_minor,currency)
       VALUES ('payment-webhook-001','event-webhook-001','order-webhook-001',25000,'KES')`,
    );
    await database.query(
      `INSERT INTO payment_attempts(
         id,payment_id,client_attempt_id,provider,amount_minor,currency,
         masked_payer_reference,initiation_idempotency_key,dispatch_started_at,provider_request_id
       ) VALUES (
         'attempt-webhook-001','payment-webhook-001','client-webhook-001','MPESA',25000,'KES',
         '254****5678','webhook-idempotency-001',clock_timestamp(),'checkout-request-001'
       )`,
    );
    await database.query(
      `INSERT INTO payment_attempt_state(attempt_id,state,reconciliation_required,updated_at)
       VALUES ('attempt-webhook-001','PENDING',true,clock_timestamp())`,
    );
  });

  afterAll(async () => {
    await database.onModuleDestroy();
  });

  it('persists a correlation-only success callback but leaves the attempt pending for query truth', async () => {
    const first = await webhooks.ingest({ headers: {}, body: {}, receivedAt: new Date().toISOString() });
    const second = await webhooks.ingest({ headers: {}, body: {}, receivedAt: new Date().toISOString() });

    expect(first).toEqual({
      duplicate: false,
      correlatedAttemptId: 'attempt-webhook-001',
      reconciliationRequested: true,
    });
    expect(second.duplicate).toBe(true);

    const state = await database.query<{
      state: string;
      reconciliation_required: boolean;
      next_query_at: Date | null;
    }>(
      `SELECT state,reconciliation_required,next_query_at
       FROM payment_attempt_state WHERE attempt_id = 'attempt-webhook-001'`,
    );
    expect(state[0]!.state).toBe('PENDING');
    expect(state[0]!.reconciliation_required).toBe(true);
    expect(state[0]!.next_query_at).not.toBeNull();

    const observations = await database.query<{
      count: string;
      provider_receipt_reference: string | null;
    }>(
      `SELECT count(*)::text AS count, max(provider_receipt_reference) AS provider_receipt_reference
       FROM payment_provider_observations`,
    );
    expect(observations[0]).toEqual({
      count: '1',
      provider_receipt_reference: 'RECEIPT-001',
    });

    const canonical = await database.query<{ provider_receipt_reference: string | null }>(
      `SELECT provider_receipt_reference FROM payment_attempts WHERE id = 'attempt-webhook-001'`,
    );
    expect(canonical[0]!.provider_receipt_reference).toBeNull();
  });

  it('does not create money truth for an unknown provider request ID', async () => {
    provider.observation = {
      ...provider.observation,
      observationKey: 'unknown-observation-002',
      providerRequestId: 'unknown-checkout-request',
    };
    const result = await webhooks.ingest({ headers: {}, body: {}, receivedAt: new Date().toISOString() });
    expect(result.correlatedAttemptId).toBeNull();
    expect(result.reconciliationRequested).toBe(false);

    const exceptions = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM payment_reconciliation_exceptions
       WHERE exception_type = 'UNKNOWN_PROVIDER_REQUEST_ID'`,
    );
    expect(exceptions[0]!.count).toBe('1');

    const attempts = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM payment_attempts',
    );
    expect(attempts[0]!.count).toBe('1');
  });

  it('flags semantic reuse of one observation key instead of overwriting the first observation', async () => {
    await webhooks.ingest({ headers: {}, body: {}, receivedAt: new Date().toISOString() });
    provider.observation = {
      ...provider.observation,
      outcome: 'FAILED',
      payloadHash: 'different-hash',
    };
    const duplicate = await webhooks.ingest({
      headers: {},
      body: {},
      receivedAt: new Date().toISOString(),
    });
    expect(duplicate.duplicate).toBe(true);

    const exceptions = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM payment_reconciliation_exceptions
       WHERE exception_type = 'WEBHOOK_OBSERVATION_KEY_REUSE'`,
    );
    expect(exceptions[0]!.count).toBe('1');
  });
});
