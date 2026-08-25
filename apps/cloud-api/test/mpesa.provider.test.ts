import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MpesaProvider } from '../src/payments/mpesa.provider';

const request = {
  paymentAttemptId: 'attempt-1',
  idempotencyKey: 'PAYMENT:order-1:primary:attempt-1',
  amountMinor: 15000,
  currency: 'KES',
  customerPhone: '254700000001',
  accountReference: 'order-1',
  description: 'Order order-1',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function callback(resultCode: number, includeMetadata = true) {
  return {
    Body: {
      stkCallback: {
        MerchantRequestID: 'merchant-1',
        CheckoutRequestID: 'checkout-1',
        ResultCode: resultCode,
        ResultDesc: resultCode === 0 ? 'Success' : 'Cancelled',
        ...(includeMetadata
          ? {
              CallbackMetadata: {
                Item: [
                  { Name: 'Amount', Value: 150 },
                  { Name: 'MpesaReceiptNumber', Value: 'MPESA123' },
                ],
              },
            }
          : {}),
      },
    },
  };
}

describe('M-PESA provider certainty and fault handling', () => {
  beforeEach(() => {
    process.env.MPESA_BASE_URL = 'https://mpesa.example.test';
    process.env.MPESA_CONSUMER_KEY = 'consumer-key';
    process.env.MPESA_CONSUMER_SECRET = 'consumer-secret';
    process.env.MPESA_BUSINESS_SHORT_CODE = '174379';
    process.env.MPESA_PASSKEY = 'passkey';
    process.env.MPESA_CALLBACK_URL = 'https://api.example.test/payments/callbacks/mpesa';
    process.env.MPESA_TIMEOUT_MS = '1000';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const name of [
      'MPESA_BASE_URL',
      'MPESA_CONSUMER_KEY',
      'MPESA_CONSUMER_SECRET',
      'MPESA_BUSINESS_SHORT_CODE',
      'MPESA_PASSKEY',
      'MPESA_CALLBACK_URL',
      'MPESA_TIMEOUT_MS',
      'MPESA_TRANSACTION_TYPE',
    ]) {
      delete process.env[name];
    }
  });

  it('reports unavailable when credentials are incomplete', () => {
    delete process.env.MPESA_PASSKEY;
    expect(new MpesaProvider().availability()).toEqual({
      status: 'UNCONFIGURED',
      detailCode: 'MPESA_CREDENTIALS_MISSING',
    });
  });

  it('initiates whole-KES STK requests and returns provider identity', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-1' }))
      .mockResolvedValueOnce(
        jsonResponse({
          MerchantRequestID: 'merchant-1',
          CheckoutRequestID: 'checkout-1',
          ResponseCode: '0',
          ResponseDescription: 'Success. Request accepted for processing',
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await new MpesaProvider().initiate(request);

    expect(result).toEqual({
      status: 'PENDING',
      providerReference: 'checkout-1',
      providerRequestId: 'merchant-1',
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://mpesa.example.test/mpesa/stkpush/v1/processrequest',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer token-1' }),
        body: expect.stringContaining('"Amount":150'),
      }),
    );
  });

  it('rejects unsupported or non-whole-KES amounts before network access', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const provider = new MpesaProvider();

    await expect(provider.initiate({ ...request, currency: 'USD' })).resolves.toEqual({
      status: 'FAILED',
      failureCode: 'UNSUPPORTED_CURRENCY',
    });
    await expect(provider.initiate({ ...request, amountMinor: 15001 })).resolves.toEqual({
      status: 'FAILED',
      failureCode: 'MPESA_WHOLE_KES_REQUIRED',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps an initiation timeout UNKNOWN rather than falsely declining it', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-1' }))
      .mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new MpesaProvider().initiate(request)).resolves.toEqual({
      status: 'UNKNOWN',
      failureCode: 'PROVIDER_TIMEOUT',
    });
  });

  it('keeps transport failures UNKNOWN so reconciliation remains required', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')));

    await expect(new MpesaProvider().initiate(request)).resolves.toEqual({
      status: 'UNKNOWN',
      failureCode: 'PROVIDER_TRANSPORT_ERROR',
    });
  });

  it('preserves explicit provider rejection as FAILED', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-1' }))
      .mockResolvedValueOnce(
        jsonResponse({ errorCode: '500.001.1001', errorMessage: 'Unable to lock subscriber' }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(new MpesaProvider().initiate(request)).resolves.toEqual({
      status: 'FAILED',
      failureCode: '500.001.1001',
    });
  });

  it('maps authenticated status-query success, failure and pending without inventing certainty', async () => {
    const provider = new MpesaProvider();

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ access_token: 'token-1' }))
        .mockResolvedValueOnce(jsonResponse({ CheckoutRequestID: 'checkout-1', ResultCode: '0' })),
    );
    await expect(provider.queryStatus('checkout-1')).resolves.toEqual({
      status: 'SUCCEEDED',
      providerReference: 'checkout-1',
    });

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ access_token: 'token-2' }))
        .mockResolvedValueOnce(
          jsonResponse({ CheckoutRequestID: 'checkout-1', ResultCode: '1032' }),
        ),
    );
    await expect(provider.queryStatus('checkout-1')).resolves.toEqual({
      status: 'FAILED',
      providerReference: 'checkout-1',
      failureCode: '1032',
    });

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ access_token: 'token-3' }))
        .mockResolvedValueOnce(
          jsonResponse({ CheckoutRequestID: 'checkout-1', ResponseCode: '0' }),
        ),
    );
    await expect(provider.queryStatus('checkout-1')).resolves.toEqual({
      status: 'PENDING',
      providerReference: 'checkout-1',
    });
  });

  it('keeps query timeout UNKNOWN', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ access_token: 'token-1' }))
        .mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError')),
    );

    await expect(new MpesaProvider().queryStatus('checkout-1')).resolves.toEqual({
      status: 'UNKNOWN',
      providerReference: 'checkout-1',
      failureCode: 'PROVIDER_TIMEOUT',
    });
  });

  it('treats a successful callback as evidence only, not unauthenticated financial truth', async () => {
    const result = await new MpesaProvider().parseAndVerifyWebhook(callback(0));

    expect(result).toEqual({
      providerEventKey: 'merchant-1:checkout-1:0:MPESA123',
      providerReference: 'checkout-1',
      status: 'UNKNOWN',
      amountMinor: 15000,
      currency: 'KES',
      failureCode: 'MPESA_CALLBACK_RESULT_0',
    });
  });

  it('retains a failed callback as UNKNOWN until query/reconciliation establishes truth', async () => {
    const result = await new MpesaProvider().parseAndVerifyWebhook(callback(1032, false));

    expect(result).toEqual({
      providerEventKey: 'merchant-1:checkout-1:1032:',
      providerReference: 'checkout-1',
      status: 'UNKNOWN',
      failureCode: 'MPESA_CALLBACK_RESULT_1032',
    });
  });

  it('rejects malformed successful callbacks without a valid amount', async () => {
    await expect(new MpesaProvider().parseAndVerifyWebhook(callback(0, false))).rejects.toThrow(
      'Successful M-PESA callback missing valid Amount',
    );
  });
});
