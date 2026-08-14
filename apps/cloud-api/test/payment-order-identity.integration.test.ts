import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseService } from '../src/database/database.service';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  type ProviderInitiationInput,
  type ProviderInitiationResult,
  type ProviderQueryResult,
  type ProviderWebhookObservation,
} from '../src/payments/payment-provider';
import { PaymentService } from '../src/payments/payment.service';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

class CountingProvider implements PaymentProvider {
  readonly code = 'MPESA';
  calls: ProviderInitiationInput[] = [];

  capabilities() {
    return {
      queryStatus: true,
      refund: false,
      reverse: false,
      webhookVerification: 'NONE' as const,
    };
  }

  async initiate(input: ProviderInitiationInput): Promise<ProviderInitiationResult> {
    this.calls.push(input);
    return {
      outcome: 'ACCEPTED_FOR_PROCESSING',
      providerRequestId: `checkout-${input.attemptId}`,
      providerReceiptReference: null,
      reasonCode: '0',
    };
  }

  async queryStatus(): Promise<ProviderQueryResult> {
    throw new Error('not used');
  }

  async parseAndVerifyWebhook(): Promise<ProviderWebhookObservation> {
    throw new Error('not used');
  }
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    eventId: 'logical-payment-event-001',
    orderId: 'logical-payment-order-001',
    paymentId: 'logical-payment-001',
    attemptId: 'logical-attempt-001',
    clientAttemptId: 'logical-client-attempt-001',
    idempotencyKey: 'PAYMENT:logical-payment-order-001:full:logical-client-attempt-001',
    provider: 'MPESA' as const,
    amountMinor: 25_000,
    currency: 'KES',
    payer: { kind: 'MSISDN' as const, value: '254712345678' },
    ...overrides,
  };
}

describeIntegration('logical payment identity', () => {
  let database: DatabaseService;
  let payments: PaymentService;
  let provider: CountingProvider;

  beforeAll(async () => {
    provider = new CountingProvider();
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
    provider.calls = [];
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

  it('cannot dispatch a second logical payment ID for an order that already has an unresolved payment', async () => {
    await payments.initiate(input());

    await expect(
      payments.initiate(
        input({
          paymentId: 'logical-payment-002',
          attemptId: 'logical-attempt-002',
          clientAttemptId: 'logical-client-attempt-002',
          idempotencyKey: 'PAYMENT:logical-payment-order-001:full:logical-client-attempt-002',
        }),
      ),
    ).rejects.toThrow();

    expect(provider.calls).toHaveLength(1);
    const rows = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM payments
       WHERE event_id = 'logical-payment-event-001' AND order_id = 'logical-payment-order-001'`,
    );
    expect(rows[0]!.count).toBe('1');
  });
});
