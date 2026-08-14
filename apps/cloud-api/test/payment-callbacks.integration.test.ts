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

class CallbackProvider implements PaymentProvider {
  readonly id = 'fake';
  callback: VerifiedProviderCallback = {
    providerEventKey: 'callback-1',
    providerReference: 'provider-ref',
    status: 'PENDING',
    amountMinor: 15000,
    currency: 'KES',
  };
  initiationGate: Promise<void> | undefined;
  onInitiationStarted: (() => void) | undefined;

  capabilities(): PaymentProviderCapabilities {
    return {
      queryStatus: true,
      refunds: false,
      reversals: false,
      asynchronousCallbacks: true,
    };
  }

  async initiate(request: ProviderInitiationRequest): Promise<ProviderInitiationResult> {
    void request;
    this.onInitiationStarted?.();
    if (this.initiationGate) await this.initiationGate;
    return { status: 'PENDING', providerReference: 'provider-ref' };
  }

  async queryStatus(providerReference: string): Promise<ProviderStatusResult> {
    return { status: 'PENDING', providerReference };
  }

  async parseAndVerifyWebhook(payload: unknown): Promise<VerifiedProviderCallback> {
    void payload;
    return this.callback;
  }
}

describeIntegration('Cloud payment callback safety', () => {
  let moduleRef: TestingModule;
  let database: DatabaseService;
  let provider: CallbackProvider;
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
    provider = new CallbackProvider();
    payments = new PaymentsService(database, [provider]);
  });

  afterAll(async () => {
    delete process.env.PAYMENT_RECONCILIATION_DISABLED;
    await moduleRef.close();
  });

  async function seedAttempt(status: 'PENDING' | 'SUCCEEDED' = 'PENDING') {
    await database.query(
      `INSERT INTO payments(id,event_id,order_id,amount_minor,currency)
       VALUES ('payment-callback','event-1','order-1',15000,'KES')`,
    );
    await database.query(
      `INSERT INTO payment_attempts(
         id,payment_id,provider_id,idempotency_key,status,provider_reference,
         request_fingerprint,initiated_at,resolved_at
       ) VALUES (
         'attempt-callback','payment-callback','fake','callback-seed',$1,'provider-ref',
         'seed',now(),CASE WHEN $1='SUCCEEDED' THEN now() ELSE NULL END
       )`,
      [status],
    );
  }

  it('deduplicates repeated provider callbacks before a second business effect', async () => {
    await seedAttempt();

    const first = await payments.ingestProviderCallback('fake', { callback: 1 });
    const replay = await payments.ingestProviderCallback('fake', { callback: 1 });

    expect(first.status).toBe('APPLIED');
    expect(replay.status).toBe('DUPLICATE');
    const events = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM payment_provider_events`,
    );
    expect(events[0]?.count).toBe('1');
  });

  it('links a callback that arrives before the provider initiation response', async () => {
    let release!: () => void;
    let startedSignal!: () => void;
    provider.initiationGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      startedSignal = resolve;
    });
    provider.onInitiationStarted = startedSignal;

    const initiation = payments.initiate({
      eventId: 'event-1',
      paymentId: 'payment-early',
      paymentAttemptId: 'attempt-early',
      orderId: 'order-early',
      providerId: 'fake',
      idempotencyKey: 'PAYMENT:order-early:primary:1',
      amountMinor: 15000,
      currency: 'KES',
      accountReference: 'ORDER-EARLY',
    });
    await started;

    const early = await payments.ingestProviderCallback('fake', { callback: 'early' });
    expect(early.status).toBe('UNMATCHED');

    release();
    const result = await initiation;
    expect(result.status).toBe('PENDING');
    expect(result.providerReference).toBe('provider-ref');

    const events = await database.query<{ payment_attempt_id: string | null }>(
      `SELECT payment_attempt_id FROM payment_provider_events WHERE provider_event_key='callback-1'`,
    );
    expect(events[0]?.payment_attempt_id).toBe('attempt-early');
  });

  it('moves amount-mismatched provider truth to UNKNOWN manual review', async () => {
    await seedAttempt();
    provider.callback = {
      ...provider.callback,
      providerEventKey: 'callback-mismatch',
      amountMinor: 16000,
    };

    const outcome = await payments.ingestProviderCallback('fake', { callback: 'mismatch' });
    expect(outcome.status).toBe('CONFLICT');

    const attempts = await database.query<{ status: string; failure_code: string | null }>(
      `SELECT status,failure_code FROM payment_attempts WHERE id='attempt-callback'`,
    );
    expect(attempts[0]).toEqual({ status: 'UNKNOWN', failure_code: 'PROVIDER_AMOUNT_MISMATCH' });
    const jobs = await database.query<{ status: string; last_error_code: string | null }>(
      `SELECT status,last_error_code FROM payment_reconciliation_jobs
       WHERE payment_attempt_id='attempt-callback'`,
    );
    expect(jobs[0]).toEqual({
      status: 'MANUAL_REVIEW',
      last_error_code: 'PROVIDER_AMOUNT_MISMATCH',
    });
  });

  it('preserves terminal success when later provider truth conflicts', async () => {
    await seedAttempt('SUCCEEDED');
    provider.callback = {
      providerEventKey: 'callback-conflict',
      providerReference: 'provider-ref',
      status: 'FAILED',
      failureCode: 'LATE_FAILURE',
    };

    const outcome = await payments.ingestProviderCallback('fake', { callback: 'conflict' });
    expect(outcome.status).toBe('CONFLICT');

    const attempts = await database.query<{ status: string }>(
      `SELECT status FROM payment_attempts WHERE id='attempt-callback'`,
    );
    expect(attempts[0]?.status).toBe('SUCCEEDED');
    const jobs = await database.query<{ status: string; last_error_code: string | null }>(
      `SELECT status,last_error_code FROM payment_reconciliation_jobs
       WHERE payment_attempt_id='attempt-callback'`,
    );
    expect(jobs[0]).toEqual({
      status: 'MANUAL_REVIEW',
      last_error_code: 'CONFLICTING_PROVIDER_TRUTH',
    });
  });
});
