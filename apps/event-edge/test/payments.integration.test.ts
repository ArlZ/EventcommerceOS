import 'reflect-metadata';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { EdgeDatabaseService } from '../src/database/database.service';
import { EdgePaymentsService } from '../src/payments/payments.service';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

function cloudView(status: 'PENDING' | 'SUCCEEDED', providerReference = 'provider-ref') {
  return {
    eventId: 'event-edge-payment',
    paymentId: 'payment-edge',
    paymentAttemptId: 'attempt-edge',
    orderId: 'order-edge',
    providerId: 'fake',
    amountMinor: 15000,
    currency: 'KES',
    status,
    providerReference,
    failureCode: null,
    reconciliationRequired: false,
    createdAt: '2026-08-14T10:00:00.000Z',
    updatedAt: '2026-08-14T10:00:00.000Z',
  };
}

function request() {
  return {
    eventId: 'event-edge-payment',
    paymentId: 'payment-edge',
    paymentAttemptId: 'attempt-edge',
    orderId: 'order-edge',
    providerId: 'fake',
    idempotencyKey: 'PAYMENT:order-edge:primary:attempt-edge',
    amountMinor: 15000,
    currency: 'KES',
    accountReference: 'ORDER-EDGE',
  };
}

describeIntegration('Edge payment cache safety', () => {
  let moduleRef: TestingModule;
  let database: EdgeDatabaseService;
  let payments: EdgePaymentsService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    database = moduleRef.get(EdgeDatabaseService);
    payments = moduleRef.get(EdgePaymentsService);
  });

  beforeEach(async () => {
    await database.query('TRUNCATE edge_payment_attempt_cache CASCADE');
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await moduleRef.close();
  });

  it('does not let a late pending response regress cached success', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify(cloudView('SUCCEEDED')), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify(cloudView('PENDING')), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
    );

    const succeeded = await payments.initiate(request());
    expect(succeeded.status).toBe('SUCCEEDED');

    const stale = await payments.initiate(request());
    expect(stale.status).toBe('SUCCEEDED');
    expect(stale.providerReference).toBe('provider-ref');
  });

  it('rejects payment-attempt identity reuse before contacting Cloud', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(cloudView('PENDING')), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await payments.initiate(request());
    await expect(payments.initiate({ ...request(), amountMinor: 16000 })).rejects.toThrow(
      'payment attempt identity conflicts with Edge cache',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('turns conflicting nonterminal provider references into UNKNOWN', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify(cloudView('PENDING', 'provider-ref-a')), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify(cloudView('PENDING', 'provider-ref-b')), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
    );

    const pending = await payments.initiate(request());
    expect(pending.status).toBe('PENDING');

    const conflicted = await payments.initiate(request());
    expect(conflicted.status).toBe('UNKNOWN');
    expect(conflicted.failureCode).toBe('EDGE_PROVIDER_REFERENCE_CONFLICT');
    expect(conflicted.providerReference).toBe('provider-ref-a');
  });
});
