import { afterEach, describe, expect, it, vi } from 'vitest';
import { MpesaProvider } from '../src/payments/mpesa.provider';
import { parseInitiatePaymentRequest } from '../src/payments/payment-validation';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe('payment request validation', () => {
  it('accepts integer minor units with explicit event/order context', () => {
    expect(
      parseInitiatePaymentRequest({
        eventId: 'event-1',
        paymentId: 'payment-1',
        paymentAttemptId: 'attempt-1',
        orderId: 'order-1',
        providerId: 'MPESA',
        idempotencyKey: 'PAYMENT:order-1:primary:attempt-1',
        amountMinor: 15000,
        currency: 'kes',
        customerPhone: '254700000000',
        accountReference: 'ORDER-1',
      }),
    ).toMatchObject({ providerId: 'mpesa', amountMinor: 15000, currency: 'KES' });
  });

  it('rejects floating point money', () => {
    expect(() =>
      parseInitiatePaymentRequest({
        eventId: 'e',
        paymentId: 'p',
        paymentAttemptId: 'a',
        orderId: 'o',
        providerId: 'mpesa',
        idempotencyKey: 'k',
        amountMinor: 100.5,
        currency: 'KES',
        accountReference: 'o',
      }),
    ).toThrow('amountMinor must be a positive safe integer');
  });
});

describe('M-PESA callback parsing', () => {
  it('normalizes a successful STK callback without persisting phone metadata', async () => {
    const provider = new MpesaProvider();
    const callback = await provider.parseAndVerifyWebhook({
      Body: {
        stkCallback: {
          MerchantRequestID: 'merchant-1',
          CheckoutRequestID: 'checkout-1',
          ResultCode: 0,
          ResultDesc: 'processed',
          CallbackMetadata: {
            Item: [
              { Name: 'Amount', Value: 150 },
              { Name: 'MpesaReceiptNumber', Value: 'ABC123XYZ' },
              { Name: 'PhoneNumber', Value: 254700000000 },
            ],
          },
        },
      },
    });

    expect(callback).toMatchObject({
      providerReference: 'checkout-1',
      status: 'SUCCEEDED',
      amountMinor: 15000,
      currency: 'KES',
    });
    expect(JSON.stringify(callback)).not.toContain('254700000000');
  });

  it('normalizes a definitive provider failure', async () => {
    const provider = new MpesaProvider();
    await expect(
      provider.parseAndVerifyWebhook({
        Body: {
          stkCallback: {
            MerchantRequestID: 'merchant-1',
            CheckoutRequestID: 'checkout-1',
            ResultCode: 1032,
            ResultDesc: 'cancelled',
          },
        },
      }),
    ).resolves.toMatchObject({ status: 'FAILED', failureCode: '1032' });
  });

  it('rejects malformed callbacks', async () => {
    const provider = new MpesaProvider();
    await expect(provider.parseAndVerifyWebhook({ Body: { stkCallback: {} } })).rejects.toThrow(
      'CheckoutRequestID',
    );
  });
});

describe('M-PESA initiation uncertainty', () => {
  it('rejects non-KES and fractional-shilling minor units before network activity', async () => {
    const provider = new MpesaProvider();
    await expect(
      provider.initiate({
        paymentAttemptId: 'attempt-1',
        idempotencyKey: 'k',
        amountMinor: 100,
        currency: 'USD',
        customerPhone: '254700000000',
        accountReference: 'order-1',
      }),
    ).resolves.toMatchObject({ status: 'FAILED', failureCode: 'UNSUPPORTED_CURRENCY' });

    await expect(
      provider.initiate({
        paymentAttemptId: 'attempt-1',
        idempotencyKey: 'k',
        amountMinor: 1050,
        currency: 'KES',
        customerPhone: '254700000000',
        accountReference: 'order-1',
      }),
    ).resolves.toMatchObject({ status: 'FAILED', failureCode: 'MPESA_WHOLE_KES_REQUIRED' });
  });

  it('returns UNKNOWN on provider transport failure instead of false failure', async () => {
    process.env.MPESA_CONSUMER_KEY = 'key';
    process.env.MPESA_CONSUMER_SECRET = 'secret';
    process.env.MPESA_BUSINESS_SHORT_CODE = '174379';
    process.env.MPESA_PASSKEY = 'passkey';
    process.env.MPESA_CALLBACK_URL = 'https://example.test/callback';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')));

    const provider = new MpesaProvider();
    await expect(
      provider.initiate({
        paymentAttemptId: 'attempt-1',
        idempotencyKey: 'k',
        amountMinor: 15000,
        currency: 'KES',
        customerPhone: '254700000000',
        accountReference: 'order-1',
      }),
    ).resolves.toMatchObject({ status: 'UNKNOWN', failureCode: 'PROVIDER_TRANSPORT_ERROR' });
  });
});
