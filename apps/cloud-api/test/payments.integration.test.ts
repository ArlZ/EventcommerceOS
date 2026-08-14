import 'reflect-metadata';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PaymentProviderCapabilities } from '@event-commerce/domain';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import type {
  PaymentProvider,
  ProviderInitiationRequest,
  ProviderInitiationResult,
  ProviderStatusResult,
  VerifiedProviderCallback,
} from '../src/payments/payment-provider';
import { PaymentsService } from '../src/payments/payments.service';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

class FakePaymentProvider implements PaymentProvider {
  readonly id = 'fake';
  initiations = 0;
  queryResult: ProviderStatusResult = { status: 'UNKNOWN', failureCode: 'NOT_YET_KNOWN' };
  initiationResult: ProviderInitiationResult = {
    status: 'UNKNOWN',
    providerReference: 'fake-provider-ref',
    failureCode: 'PROVIDER_TIMEOUT',
  };

  capabilities(): PaymentProviderCapabilities {
    return {
      queryStatus: true,
      refunds: false,
      reversals: false,
      asynchronousCallbacks: true,
    };
  }

  async initiate(_request: ProviderInitiationRequest): Promise<ProviderInitiationResult> {
    this.initiations += 1;
    return this.initiationResult;
  }

  async queryStatus(providerReference: string): Promise<ProviderStatusResult> {
    return { ...this.queryResult, providerReference };
  }

  async parseAndVerifyWebhook(_payload: unknown): Promise<VerifiedProviderCallback> {
    return {
      providerEventKey: 'fake-event',
      providerReference: 'fake-provider-ref',
      status: 'UNKNOWN',
      failureCode: 'CALLBACK_SIGNAL',
    };
  }
}

describeIntegration('Cloud payment orchestration', () => {
  let database: DatabaseService;
  let moduleRef: TestingModule;
  let provider: FakePaymentProvider;
  let payments: PaymentsService;

  beforeAll(async () => {
    process.env.PAYMENT_RECONCILIATION_DISABLED = 'true';
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    database = moduleRef.get(DatabaseService);
  });

  beforeEach(async () => {
    await database.query(
      `TRUNCATE
         payment_provider_events,
         payment_reconciliation_jobs,
         payment_refunds,
         payment_reversals,
         payment_attempts,
         payments
       CASCADE`,
    );
    provider = new FakePaymentProvider();
    payments = new PaymentsService(database, [provider]);
  });

  afterAll(async () => {
    delete process.env.PAYMENT_RECONCILIATION_DISABLED;
    await moduleRef.close();
  });

  const request = () => ({
    eventId: 'event-payments',
    paymentId: 'payment-1',
    paymentAttemptId: 'attempt-1',
    orderId: 'order-1',
    providerId: 'fake',
    idempotencyKey: 'PAYMENT:order-1:primary:client-1',
    amountMinor: 15000,
    currency: 'KES',
    accountReference: 'ORDER-1',
  });

  it('replays the same initiation without invoking the provider twice', async () => {
    const first = await payments.initiate(request());
    const replay = await payments.initiate(request());

    expect(provider.initiations).toBe(1);
    expect(first.paymentAttemptId).toBe('attempt-1');
    expect(replay.paymentAttemptId).toBe('attempt-1');

    const rows = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM payment_attempts WHERE idempotency_key=$1`,
      [request().idempotencyKey],
    );
    expect(rows[0]?.count).toBe('1');
  });

  it('keeps provider timeout UNKNOWN until an authoritative status query resolves it', async () => {
    const uncertain = await payments.initiate(request());
    expect(uncertain.status).toBe('UNKNOWN');

    provider.queryResult = { status: 'SUCCEEDED' };
    const resolved = await payments.reconcileAttempt('attempt-1');

    expect(resolved.status).toBe('SUCCEEDED');
    expect(resolved.providerReference).toBe('fake-provider-ref');
    const jobs = await database.query<{ status: string }>(
      `SELECT status FROM payment_reconciliation_jobs WHERE payment_attempt_id='attempt-1'`,
    );
    expect(jobs[0]?.status).toBe('RESOLVED');
  });

  it('rejects reuse of an idempotency key for a different amount', async () => {
    await payments.initiate(request());

    await expect(
      payments.initiate({ ...request(), amountMinor: 16000, paymentAttemptId: 'attempt-2' }),
    ).rejects.toThrow('Idempotency key was reused for a different payment request');
    expect(provider.initiations).toBe(1);
  });
});
