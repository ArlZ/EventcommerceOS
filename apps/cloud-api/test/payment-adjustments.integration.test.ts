import 'reflect-metadata';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PaymentProviderCapabilities } from '@event-commerce/domain';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { PaymentAdjustmentsService } from '../src/payments/payment-adjustments.service';
import type {
  PaymentProvider,
  ProviderInitiationRequest,
  ProviderInitiationResult,
  ProviderStatusResult,
  VerifiedProviderCallback,
} from '../src/payments/payment-provider';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

class AdjustmentProvider implements PaymentProvider {
  readonly id = 'fake';
  refundCalls = 0;
  reversalCalls = 0;
  refundGate: Promise<void> | undefined;
  onRefundStarted: (() => void) | undefined;

  capabilities(): PaymentProviderCapabilities {
    return {
      queryStatus: true,
      refunds: true,
      reversals: true,
      asynchronousCallbacks: false,
    };
  }

  async initiate(request: ProviderInitiationRequest): Promise<ProviderInitiationResult> {
    void request;
    return { status: 'PENDING', providerReference: 'source-provider-ref' };
  }

  async queryStatus(providerReference: string): Promise<ProviderStatusResult> {
    return { status: 'SUCCEEDED', providerReference };
  }

  async parseAndVerifyWebhook(payload: unknown): Promise<VerifiedProviderCallback> {
    void payload;
    throw new Error('callbacks are not used by adjustment tests');
  }

  async refund(): Promise<ProviderStatusResult> {
    this.refundCalls += 1;
    this.onRefundStarted?.();
    if (this.refundGate) await this.refundGate;
    return { status: 'SUCCEEDED', providerReference: `refund-ref-${this.refundCalls}` };
  }

  async reverse(): Promise<ProviderStatusResult> {
    this.reversalCalls += 1;
    return { status: 'SUCCEEDED', providerReference: `reversal-ref-${this.reversalCalls}` };
  }
}

describeIntegration('Cloud payment refunds and reversals', () => {
  let database: DatabaseService;
  let moduleRef: TestingModule;
  let provider: AdjustmentProvider;
  let adjustments: PaymentAdjustmentsService;

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
    await database.query(
      `INSERT INTO payments(id,event_id,order_id,amount_minor,currency)
       VALUES ('payment-adjust','event-1','order-1',15000,'KES')`,
    );
    await database.query(
      `INSERT INTO payment_attempts(
         id,payment_id,provider_id,idempotency_key,status,provider_reference,
         request_fingerprint,initiated_at,resolved_at
       ) VALUES (
         'attempt-adjust','payment-adjust','fake','seed-payment-adjust','SUCCEEDED',
         'source-provider-ref','seed',now(),now()
       )`,
    );
    provider = new AdjustmentProvider();
    adjustments = new PaymentAdjustmentsService(database, [provider]);
  });

  afterAll(async () => {
    delete process.env.PAYMENT_RECONCILIATION_DISABLED;
    await moduleRef.close();
  });

  const refundRequest = () => ({
    refundId: 'refund-1',
    paymentId: 'payment-adjust',
    amountMinor: 5000,
    currency: 'KES',
    reason: 'customer return',
    requestingActorId: 'operator-1',
    approvingActorId: 'manager-1',
    idempotencyKey: 'REFUND:payment-adjust:refund-1',
  });

  it('retries a refund with one provider effect and one immutable refund intent', async () => {
    const first = await adjustments.refund(refundRequest());
    const replay = await adjustments.refund(refundRequest());

    expect(first.status).toBe('SUCCEEDED');
    expect(replay.id).toBe(first.id);
    expect(replay.amountMinor).toBe(5000);
    expect(provider.refundCalls).toBe(1);

    const rows = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM payment_refunds WHERE payment_id='payment-adjust'`,
    );
    expect(rows[0]?.count).toBe('1');

    const attempt = await database.query<{ status: string; provider_reference: string }>(
      `SELECT status,provider_reference FROM payment_attempts WHERE id='attempt-adjust'`,
    );
    expect(attempt[0]).toEqual({ status: 'SUCCEEDED', provider_reference: 'source-provider-ref' });
  });

  it('does not invoke the refund provider twice when the retry arrives in flight', async () => {
    let release!: () => void;
    let startedSignal!: () => void;
    provider.refundGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      startedSignal = resolve;
    });
    provider.onRefundStarted = startedSignal;

    const firstPromise = adjustments.refund(refundRequest());
    await started;
    const replay = await adjustments.refund(refundRequest());

    expect(replay.status).toBe('REQUESTED');
    expect(provider.refundCalls).toBe(1);

    release();
    const first = await firstPromise;
    expect(first.status).toBe('SUCCEEDED');
    expect(provider.refundCalls).toBe(1);
  });

  it('rejects adjustment idempotency-key reuse with changed intent', async () => {
    await adjustments.refund(refundRequest());

    await expect(
      adjustments.refund({ ...refundRequest(), reason: 'different reason' }),
    ).rejects.toThrow('Adjustment idempotency key was reused for a different request');
    expect(provider.refundCalls).toBe(1);
  });

  it('prevents combined refunds and reversals from exceeding the original payment', async () => {
    await adjustments.refund({ ...refundRequest(), amountMinor: 10000 });

    await expect(
      adjustments.reverse({
        reversalId: 'reversal-over',
        paymentId: 'payment-adjust',
        amountMinor: 6000,
        currency: 'KES',
        reason: 'operator correction',
        requestingActorId: 'operator-2',
        idempotencyKey: 'REVERSAL:payment-adjust:over',
      }),
    ).rejects.toThrow('Adjustment would exceed the unadjusted payment balance');
    expect(provider.reversalCalls).toBe(0);
  });

  it('preserves reversal history without mutating the original payment', async () => {
    const reversal = await adjustments.reverse({
      reversalId: 'reversal-1',
      paymentId: 'payment-adjust',
      amountMinor: 3000,
      currency: 'KES',
      reason: 'duplicate till action',
      requestingActorId: 'operator-2',
      idempotencyKey: 'REVERSAL:payment-adjust:1',
    });
    const replay = await adjustments.reverse({
      reversalId: 'reversal-1',
      paymentId: 'payment-adjust',
      amountMinor: 3000,
      currency: 'KES',
      reason: 'duplicate till action',
      requestingActorId: 'operator-2',
      idempotencyKey: 'REVERSAL:payment-adjust:1',
    });

    expect(reversal.status).toBe('SUCCEEDED');
    expect(replay.id).toBe(reversal.id);
    expect(provider.reversalCalls).toBe(1);

    const history = await adjustments.history('payment-adjust');
    expect(history.refunds).toHaveLength(0);
    expect(history.reversals).toHaveLength(1);
    expect(history.reversals[0]).toMatchObject({
      id: 'reversal-1',
      amountMinor: 3000,
      providerId: 'fake',
      status: 'SUCCEEDED',
    });
  });
});
