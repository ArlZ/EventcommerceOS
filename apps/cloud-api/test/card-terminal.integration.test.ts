import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { PaymentProviderCapabilities } from '@event-commerce/domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { ExternalTerminalProvider } from '../src/payments/external-terminal.provider';
import { ManualTerminalService } from '../src/payments/manual-terminal.service';
import type {
  PaymentProvider,
  ProviderInitiationRequest,
  ProviderInitiationResult,
  ProviderStatusResult,
  ProviderWebhookContext,
  VerifiedProviderCallback,
} from '../src/payments/payment-provider';
import { PaymentsService } from '../src/payments/payments.service';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

class DeferredTerminalProvider implements PaymentProvider {
  readonly id = 'pesapal_sabi';
  initiations = 0;
  queries = 0;
  callback: VerifiedProviderCallback = {
    providerEventKey: 'sabi:confirm-1',
    paymentAttemptId: 'attempt-card-1',
    providerReference: 'confirm-1',
    status: 'SUCCEEDED',
    amountMinor: 15000,
    currency: 'KES',
  };
  queryResult: ProviderStatusResult = {
    status: 'SUCCEEDED',
    providerReference: 'confirm-1',
    paymentAttemptId: 'attempt-card-1',
    amountMinor: 15000,
    currency: 'KES',
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
    return { status: 'PENDING', failureCode: 'AWAITING_SABI_TERMINAL' };
  }

  async queryStatus(providerReference: string): Promise<ProviderStatusResult> {
    this.queries += 1;
    return { ...this.queryResult, providerReference };
  }

  async parseAndVerifyWebhook(
    payload: unknown,
    context?: ProviderWebhookContext,
  ): Promise<VerifiedProviderCallback> {
    void payload;
    void context;
    return this.callback;
  }
}

describeIntegration('card terminal orchestration', () => {
  let database: DatabaseService;
  let moduleRef: TestingModule;
  let terminal: DeferredTerminalProvider;
  let external: ExternalTerminalProvider;
  let payments: PaymentsService;
  let manual: ManualTerminalService;

  beforeAll(async () => {
    process.env.PAYMENT_RECONCILIATION_DISABLED = 'true';
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    database = moduleRef.get(DatabaseService);
  });

  beforeEach(async () => {
    await database.query(
      `TRUNCATE
         payment_audit_events,
         payment_manual_terminal_confirmations,
         payment_actor_permissions,
         payment_provider_events,
         payment_reconciliation_jobs,
         payment_refunds,
         payment_reversals,
         payment_attempts,
         payments
       CASCADE`,
    );
    terminal = new DeferredTerminalProvider();
    external = new ExternalTerminalProvider();
    payments = new PaymentsService(database, [terminal, external]);
    manual = new ManualTerminalService(database);
  });

  afterAll(async () => {
    delete process.env.PAYMENT_RECONCILIATION_DISABLED;
    await moduleRef.close();
  });

  const cardRequest = () => ({
    eventId: 'event-card',
    paymentId: 'payment-card-1',
    paymentAttemptId: 'attempt-card-1',
    orderId: 'order-card-1',
    providerId: 'pesapal_sabi',
    idempotencyKey: 'PAYMENT:order-card-1:primary:client-card-1',
    amountMinor: 15000,
    currency: 'KES',
    accountReference: 'attempt-card-1',
  });

  const externalRequest = () => ({
    eventId: 'event-card',
    paymentId: 'payment-external-1',
    paymentAttemptId: 'attempt-external-1',
    orderId: 'order-external-1',
    providerId: 'external_terminal',
    idempotencyKey: 'PAYMENT:order-external-1:primary:client-external-1',
    amountMinor: 22500,
    currency: 'KES',
    accountReference: 'attempt-external-1',
  });

  const confirmation = () => ({
    confirmationId: 'manual-confirmation-1',
    paymentAttemptId: 'attempt-external-1',
    externalProviderId: 'bank-terminal',
    externalReference: 'receipt-abc-123',
    amountMinor: 22500,
    currency: 'KES',
    outcome: 'APPROVED' as const,
    actorId: 'supervisor-1',
    reason: 'Standalone terminal fallback',
    idempotencyKey: 'MANUAL:attempt-external-1:receipt-abc-123',
  });

  const grantManualPermission = async () => {
    await database.query(
      `INSERT INTO payment_actor_permissions(event_id,actor_id,permission)
       VALUES ('event-card','supervisor-1','PAYMENT_MANUAL_CONFIRM')`,
    );
  };

  it('replays card initiation without creating a second provider-side initiation', async () => {
    const first = await payments.initiate(cardRequest());
    const replay = await payments.initiate(cardRequest());

    expect(first.status).toBe('PENDING');
    expect(replay.paymentAttemptId).toBe(first.paymentAttemptId);
    expect(terminal.initiations).toBe(1);
    const attempts = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM payment_attempts WHERE payment_id='payment-card-1'`,
    );
    expect(attempts[0]?.count).toBe('1');
  });

  it('correlates a verified terminal callback by merchant reference before a provider reference exists', async () => {
    const pending = await payments.initiate(cardRequest());
    expect(pending.providerReference).toBeNull();

    const applied = await payments.ingestProviderCallback('pesapal_sabi', { terminal: 'signal' });
    expect(applied.status).toBe('APPLIED');

    const resolved = (await payments.byOrder('order-card-1'))[0]!;
    expect(resolved.status).toBe('SUCCEEDED');
    expect(resolved.providerReference).toBe('confirm-1');
    const jobs = await database.query<{ status: string }>(
      `SELECT status FROM payment_reconciliation_jobs WHERE payment_attempt_id='attempt-card-1'`,
    );
    expect(jobs[0]?.status).toBe('RESOLVED');
  });

  it('deduplicates a repeated terminal notification', async () => {
    await payments.initiate(cardRequest());
    expect((await payments.ingestProviderCallback('pesapal_sabi', {})).status).toBe('APPLIED');
    expect((await payments.ingestProviderCallback('pesapal_sabi', {})).status).toBe('DUPLICATE');

    const events = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM payment_provider_events
       WHERE provider_id='pesapal_sabi' AND provider_event_key='sabi:confirm-1'`,
    );
    expect(events[0]?.count).toBe('1');
  });

  it('keeps a verification timeout UNKNOWN and later resolves it through authoritative status query', async () => {
    await payments.initiate(cardRequest());
    terminal.callback = {
      ...terminal.callback,
      status: 'UNKNOWN',
      failureCode: 'PESAPAL_SABI_VERIFY_TRANSPORT_ERROR',
    };

    expect((await payments.ingestProviderCallback('pesapal_sabi', {})).status).toBe('APPLIED');
    const uncertain = (await payments.byOrder('order-card-1'))[0]!;
    expect(uncertain.status).toBe('UNKNOWN');
    expect(uncertain.providerReference).toBe('confirm-1');

    const resolved = await payments.reconcileAttempt('attempt-card-1');
    expect(resolved.status).toBe('SUCCEEDED');
    expect(resolved.providerReference).toBe('confirm-1');
    expect(terminal.queries).toBe(1);
  });

  it('surfaces amount mismatch as explicit reconciliation conflict instead of success', async () => {
    await payments.initiate(cardRequest());
    terminal.callback = { ...terminal.callback, amountMinor: 14900 };

    const result = await payments.ingestProviderCallback('pesapal_sabi', {});
    expect(result.status).toBe('CONFLICT');
    const attempt = (await payments.byOrder('order-card-1'))[0]!;
    expect(attempt.status).toBe('UNKNOWN');
    expect(attempt.failureCode).toBe('PROVIDER_AMOUNT_MISMATCH');
    const jobs = await database.query<{ status: string; last_error_code: string }>(
      `SELECT status,last_error_code FROM payment_reconciliation_jobs
       WHERE payment_attempt_id='attempt-card-1'`,
    );
    expect(jobs[0]).toMatchObject({
      status: 'MANUAL_REVIEW',
      last_error_code: 'PROVIDER_AMOUNT_MISMATCH',
    });
  });

  it('requires explicit permission for manual external-terminal confirmation', async () => {
    await payments.initiate(externalRequest());

    await expect(manual.confirm(confirmation())).rejects.toBeInstanceOf(ForbiddenException);
    const attempts = await payments.byOrder('order-external-1');
    expect(attempts[0]?.status).toBe('PENDING');
  });

  it('records one immutable manual confirmation and audit event across retries', async () => {
    await payments.initiate(externalRequest());
    await grantManualPermission();

    const first = await manual.confirm(confirmation());
    const replay = await manual.confirm(confirmation());
    expect(first.confirmationId).toBe('manual-confirmation-1');
    expect(replay.confirmationId).toBe(first.confirmationId);

    const attempt = (await payments.byOrder('order-external-1'))[0]!;
    expect(attempt.status).toBe('SUCCEEDED');
    expect(attempt.providerReference).toBe('receipt-abc-123');

    const confirmations = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM payment_manual_terminal_confirmations`,
    );
    const audits = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM payment_audit_events
       WHERE action='PAYMENT_MANUAL_TERMINAL_CONFIRMED'`,
    );
    expect(confirmations[0]?.count).toBe('1');
    expect(audits[0]?.count).toBe('1');
    expect((await manual.history('payment-external-1')).length).toBe(1);
  });

  it('rejects reuse of a manual idempotency key for different financial evidence', async () => {
    await payments.initiate(externalRequest());
    await grantManualPermission();
    await manual.confirm(confirmation());

    await expect(
      manual.confirm({ ...confirmation(), externalReference: 'different-receipt' }),
    ).rejects.toThrow('idempotency key was reused');
  });

  it('does not allow manual approval to overwrite an integrated Sabi attempt', async () => {
    await payments.initiate(cardRequest());
    await grantManualPermission();

    await expect(
      manual.confirm({ ...confirmation(), paymentAttemptId: 'attempt-card-1', amountMinor: 15000 }),
    ).rejects.toThrow('Manual approval requires an external_terminal attempt');
  });

  it('allows only a supervised reference-less Sabi decline and keeps provider reference empty', async () => {
    await payments.initiate(cardRequest());
    await grantManualPermission();

    const declined = await manual.confirm({
      confirmationId: 'sabi-decline-evidence-1',
      paymentAttemptId: 'attempt-card-1',
      externalProviderId: 'pesapal-sabi-terminal',
      externalReference: 'terminal-decline-ref-1',
      amountMinor: 15000,
      currency: 'KES',
      outcome: 'DECLINED',
      actorId: 'supervisor-1',
      reason: 'Terminal visibly declined; no confirmation code was issued',
      idempotencyKey: 'MANUAL:attempt-card-1:terminal-decline-ref-1',
    });

    expect(declined.outcome).toBe('DECLINED');
    const attempt = (await payments.byOrder('order-card-1'))[0]!;
    expect(attempt.status).toBe('FAILED');
    expect(attempt.providerReference).toBeNull();
    expect(attempt.failureCode).toBe('SABI_TERMINAL_DECLINED_MANUAL_EVIDENCE');
  });

  it('surfaces a delayed Sabi success that conflicts with supervised decline evidence', async () => {
    await payments.initiate(cardRequest());
    await grantManualPermission();
    await manual.confirm({
      confirmationId: 'sabi-decline-evidence-1',
      paymentAttemptId: 'attempt-card-1',
      externalProviderId: 'pesapal-sabi-terminal',
      externalReference: 'terminal-decline-ref-1',
      amountMinor: 15000,
      currency: 'KES',
      outcome: 'DECLINED',
      actorId: 'supervisor-1',
      reason: 'Terminal visibly declined; no confirmation code was issued',
      idempotencyKey: 'MANUAL:attempt-card-1:terminal-decline-ref-1',
    });

    const late = await payments.ingestProviderCallback('pesapal_sabi', {});
    expect(late.status).toBe('CONFLICT');
    const attempt = (await payments.byOrder('order-card-1'))[0]!;
    expect(attempt.status).toBe('FAILED');
    const jobs = await database.query<{ status: string; last_error_code: string }>(
      `SELECT status,last_error_code FROM payment_reconciliation_jobs
       WHERE payment_attempt_id='attempt-card-1'`,
    );
    expect(jobs[0]).toMatchObject({
      status: 'MANUAL_REVIEW',
      last_error_code: 'CONFLICTING_PROVIDER_TRUTH',
    });
  });
});
