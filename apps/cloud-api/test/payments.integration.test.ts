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
  queries = 0;
  initiationGate: Promise<void> | undefined;
  onInitiationStarted: (() => void) | undefined;
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

  async initiate(request: ProviderInitiationRequest): Promise<ProviderInitiationResult> {
    void request;
    this.initiations += 1;
    this.onInitiationStarted?.();
    if (this.initiationGate) await this.initiationGate;
    return this.initiationResult;
  }

  async queryStatus(providerReference: string): Promise<ProviderStatusResult> {
    this.queries += 1;
    return { ...this.queryResult, providerReference };
  }

  async parseAndVerifyWebhook(payload: unknown): Promise<VerifiedProviderCallback> {
    void payload;
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

  it('does not let a simultaneous duplicate steal the in-flight provider result', async () => {
    let releaseInitiation!: () => void;
    let signalStarted!: () => void;
    provider.initiationGate = new Promise<void>((resolve) => {
      releaseInitiation = resolve;
    });
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    provider.onInitiationStarted = signalStarted;

    const firstPromise = payments.initiate(request());
    await started;

    const replay = await payments.initiate(request());
    expect(replay.status).toBe('CREATED');
    expect(provider.initiations).toBe(1);

    releaseInitiation();
    const first = await firstPromise;
    expect(first.status).toBe('UNKNOWN');
    expect(first.providerReference).toBe('fake-provider-ref');

    const final = (await payments.byOrder('order-1'))[0];
    expect(final?.status).toBe('UNKNOWN');
    expect(final?.providerReference).toBe('fake-provider-ref');
    expect(provider.initiations).toBe(1);
  });

  it('moves stale CREATED work to UNKNOWN manual review instead of re-initiating it', async () => {
    let releaseInitiation!: () => void;
    let signalStarted!: () => void;
    provider.initiationGate = new Promise<void>((resolve) => {
      releaseInitiation = resolve;
    });
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    provider.onInitiationStarted = signalStarted;

    const firstPromise = payments.initiate(request());
    await started;
    await database.query(
      `UPDATE payment_attempts
       SET updated_at=now() - interval '2 minutes'
       WHERE id='attempt-1'`,
    );

    await (
      payments as unknown as {
        reconcileDue(): Promise<void>;
      }
    ).reconcileDue();

    const stale = (await payments.byOrder('order-1'))[0];
    expect(stale?.status).toBe('UNKNOWN');
    expect(stale?.failureCode).toBe('AMBIGUOUS_INITIATION_CRASH');
    const jobs = await database.query<{ status: string }>(
      `SELECT status FROM payment_reconciliation_jobs WHERE payment_attempt_id='attempt-1'`,
    );
    expect(jobs[0]?.status).toBe('MANUAL_REVIEW');

    releaseInitiation();
    const completedOwner = await firstPromise;
    expect(completedOwner.status).toBe('UNKNOWN');
    expect(provider.initiations).toBe(1);
  });

  it('keeps provider timeout UNKNOWN until an authoritative status query resolves it', async () => {
    const uncertain = await payments.initiate(request());
    expect(uncertain.status).toBe('UNKNOWN');

    provider.queryResult = { status: 'SUCCEEDED' };
    const resolved = await payments.reconcileAttempt('attempt-1');

    expect(resolved.status).toBe('SUCCEEDED');
    expect(resolved.providerReference).toBe('fake-provider-ref');
    expect(provider.queries).toBe(1);
    const jobs = await database.query<{ status: string }>(
      `SELECT status FROM payment_reconciliation_jobs WHERE payment_attempt_id='attempt-1'`,
    );
    expect(jobs[0]?.status).toBe('RESOLVED');
  });

  it('actively reconciles PENDING attempts even if no callback arrives', async () => {
    provider.initiationResult = {
      status: 'PENDING',
      providerReference: 'fake-provider-ref',
    };
    const pending = await payments.initiate(request());
    expect(pending.status).toBe('PENDING');

    const queued = await database.query<{ status: string; attempt_count: number }>(
      `SELECT status,attempt_count
       FROM payment_reconciliation_jobs
       WHERE payment_attempt_id='attempt-1'`,
    );
    expect(queued[0]?.status).toBe('PENDING');
    expect(queued[0]?.attempt_count).toBe(0);

    provider.queryResult = { status: 'SUCCEEDED' };
    const resolved = await payments.reconcileAttempt('attempt-1');
    expect(resolved.status).toBe('SUCCEEDED');
    expect(provider.queries).toBe(1);
  });

  it('keeps polling when a status query still reports PENDING', async () => {
    provider.initiationResult = {
      status: 'PENDING',
      providerReference: 'fake-provider-ref',
    };
    await payments.initiate(request());
    provider.queryResult = { status: 'PENDING' };

    const stillPending = await payments.reconcileAttempt('attempt-1');
    expect(stillPending.status).toBe('PENDING');
    const jobs = await database.query<{
      status: string;
      attempt_count: number;
      next_attempt_at: Date;
    }>(
      `SELECT status,attempt_count,next_attempt_at
       FROM payment_reconciliation_jobs
       WHERE payment_attempt_id='attempt-1'`,
    );
    expect(jobs[0]?.status).toBe('PENDING');
    expect(jobs[0]?.attempt_count).toBe(1);
    expect(jobs[0]?.next_attempt_at.getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects reuse of an idempotency key for a different request', async () => {
    await payments.initiate(request());

    await expect(
      payments.initiate({
        ...request(),
        paymentAttemptId: 'attempt-2',
        accountReference: 'ORDER-DIFFERENT',
      }),
    ).rejects.toThrow('Idempotency key was reused for a different payment request');
    expect(provider.initiations).toBe(1);
  });
});
