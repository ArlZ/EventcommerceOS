import { describe, expect, it } from 'vitest';
import { MpesaDarajaProvider } from '../src/payments/mpesa-daraja.provider';

type RecordedRequest = { url: string; init: RequestInit | undefined };

const environment: NodeJS.ProcessEnv = {
  MPESA_ENVIRONMENT: 'sandbox',
  MPESA_BASE_URL: 'https://daraja.test',
  MPESA_CONSUMER_KEY: 'consumer-key',
  MPESA_CONSUMER_SECRET: 'consumer-secret',
  MPESA_SHORTCODE: '174379',
  MPESA_PASSKEY: 'sandbox-passkey',
  MPESA_CALLBACK_URL: 'https://example.test/payments/webhooks/mpesa',
  MPESA_HTTP_TIMEOUT_MS: '10000',
};

function input() {
  return {
    attemptId: 'attempt-001',
    amountMinor: 25_000,
    currency: 'KES',
    accountReference: 'order-1234567890',
    payer: { kind: 'MSISDN' as const, value: '254712345678' },
  };
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('MpesaDarajaProvider', () => {
  it('uses OAuth then sends the official STK Push request shape without exposing credentials in results', async () => {
    const calls: RecordedRequest[] = [];
    const http: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('/oauth/')) {
        return jsonResponse({ access_token: 'access-token', expires_in: '3599' });
      }
      return jsonResponse({
        MerchantRequestID: 'merchant-001',
        CheckoutRequestID: 'checkout-001',
        ResponseCode: '0',
        ResponseDescription: 'Success. Request accepted for processing',
      });
    };
    const provider = new MpesaDarajaProvider(
      environment,
      http,
      () => new Date('2026-08-14T06:07:08.000Z'),
    );

    const result = await provider.initiate(input());

    expect(result).toEqual({
      outcome: 'ACCEPTED_FOR_PROCESSING',
      providerRequestId: 'checkout-001',
      providerReceiptReference: null,
      reasonCode: '0',
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe('https://daraja.test/oauth/v1/generate?grant_type=client_credentials');
    const basic = Buffer.from('consumer-key:consumer-secret').toString('base64');
    expect(new Headers(calls[0]!.init?.headers).get('authorization')).toBe(`Basic ${basic}`);

    expect(calls[1]!.url).toBe('https://daraja.test/mpesa/stkpush/v1/processrequest');
    expect(new Headers(calls[1]!.init?.headers).get('authorization')).toBe('Bearer access-token');
    const body = JSON.parse(String(calls[1]!.init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      BusinessShortCode: '174379',
      Timestamp: '20260814060708',
      TransactionType: 'CustomerPayBillOnline',
      Amount: 250,
      PartyA: '254712345678',
      PartyB: '174379',
      PhoneNumber: '254712345678',
      CallBackURL: 'https://example.test/payments/webhooks/mpesa',
      AccountReference: 'order-123456',
      TransactionDesc: 'Event payment',
    });
    expect(body.Password).toBe(
      Buffer.from('174379sandbox-passkey20260814060708').toString('base64'),
    );
  });

  it('treats OAuth failure as a safe provider failure because no STK request was sent', async () => {
    const calls: RecordedRequest[] = [];
    const http: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({ errorCode: 'AUTH' }, 401);
    };
    const provider = new MpesaDarajaProvider(environment, http);

    await expect(provider.initiate(input())).resolves.toEqual({
      outcome: 'FAILED',
      providerRequestId: null,
      providerReceiptReference: null,
      reasonCode: 'PROVIDER_AUTH_UNAVAILABLE',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('/oauth/');
  });

  it('throws on STK transport failure so orchestration cannot misclassify possible acceptance as FAILED', async () => {
    let calls = 0;
    const http: typeof fetch = async (url) => {
      calls += 1;
      if (String(url).includes('/oauth/')) {
        return jsonResponse({ access_token: 'access-token', expires_in: '3599' });
      }
      throw new Error('simulated socket timeout');
    };
    const provider = new MpesaDarajaProvider(environment, http);

    await expect(provider.initiate(input())).rejects.toThrow(/ambiguous M-PESA initiation/);
    expect(calls).toBe(2);
  });

  it('queries by CheckoutRequestID and resolves authenticated success', async () => {
    const calls: RecordedRequest[] = [];
    const http: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('/oauth/')) {
        return jsonResponse({ access_token: 'access-token', expires_in: '3599' });
      }
      return jsonResponse({
        ResponseCode: '0',
        CheckoutRequestID: 'checkout-001',
        ResultCode: '0',
        ResultDesc: 'The service request is processed successfully.',
      });
    };
    const provider = new MpesaDarajaProvider(
      environment,
      http,
      () => new Date('2026-08-14T06:07:08.000Z'),
    );

    const result = await provider.queryStatus({
      attemptId: 'attempt-001',
      providerRequestId: 'checkout-001',
    });
    expect(result).toEqual({
      outcome: 'SUCCESS',
      providerRequestId: 'checkout-001',
      providerReceiptReference: null,
      reasonCode: '0',
    });
    const queryBody = JSON.parse(String(calls[1]!.init?.body)) as Record<string, unknown>;
    expect(queryBody.CheckoutRequestID).toBe('checkout-001');
  });

  it('keeps an unfamiliar non-zero query result UNKNOWN instead of enabling a risky retry', async () => {
    const http: typeof fetch = async (url) => {
      if (String(url).includes('/oauth/')) {
        return jsonResponse({ access_token: 'access-token', expires_in: '3599' });
      }
      return jsonResponse({
        ResponseCode: '0',
        CheckoutRequestID: 'checkout-001',
        ResultCode: '98765',
        ResultDesc: 'Unclassified provider condition',
      });
    };
    const provider = new MpesaDarajaProvider(environment, http);

    await expect(
      provider.queryStatus({ attemptId: 'attempt-001', providerRequestId: 'checkout-001' }),
    ).resolves.toMatchObject({ outcome: 'UNKNOWN', reasonCode: '98765' });
  });

  it('parses STK callbacks as correlation-only observations and excludes the phone number from sanitized details', async () => {
    const provider = new MpesaDarajaProvider(environment, async () => jsonResponse({}));
    const body = {
      Body: {
        stkCallback: {
          MerchantRequestID: 'merchant-001',
          CheckoutRequestID: 'checkout-001',
          ResultCode: 0,
          ResultDesc: 'The service request is processed successfully.',
          CallbackMetadata: {
            Item: [
              { Name: 'Amount', Value: 250 },
              { Name: 'MpesaReceiptNumber', Value: 'TESTRECEIPT1' },
              { Name: 'TransactionDate', Value: 20260814090708 },
              { Name: 'PhoneNumber', Value: 254712345678 },
            ],
          },
        },
      },
    };

    const observation = await provider.parseAndVerifyWebhook({
      headers: {},
      body,
      receivedAt: '2026-08-14T06:07:09.000Z',
    });
    const duplicate = await provider.parseAndVerifyWebhook({
      headers: {},
      body,
      receivedAt: '2026-08-14T06:08:09.000Z',
    });

    expect(observation).toMatchObject({
      observationKey: 'stk:checkout-001',
      providerRequestId: 'checkout-001',
      outcome: 'SUCCESS',
      providerReceiptReference: 'TESTRECEIPT1',
      verificationStrength: 'CORRELATION_ONLY',
      reasonCode: '0',
      sanitizedDetails: {
        resultCode: '0',
        amount: 250,
        transactionDate: '20260814090708',
        hasReceiptReference: true,
      },
    });
    expect(observation.payloadHash).toBe(duplicate.payloadHash);
    expect(JSON.stringify(observation.sanitizedDetails)).not.toContain('254712345678');
    expect(JSON.stringify(observation.sanitizedDetails)).not.toContain('TESTRECEIPT1');
  });

  it('rejects malformed callbacks before they can enter reconciliation storage', async () => {
    const provider = new MpesaDarajaProvider(environment, async () => jsonResponse({}));
    await expect(
      provider.parseAndVerifyWebhook({ headers: {}, body: { Body: {} }, receivedAt: new Date().toISOString() }),
    ).rejects.toThrow(/invalid M-PESA STK callback/);
  });
});
