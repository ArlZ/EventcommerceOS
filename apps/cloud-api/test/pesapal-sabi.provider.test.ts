import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PesapalSabiProvider } from '../src/payments/pesapal-sabi.provider';

const successVerification = {
  amount: 150,
  posting_status: 0,
  transaction_date: '2026-06-17T07:19:53.767',
  status: 1,
  status_description: 'completed',
  currency: 'KES',
  merchant_ref: 'attempt-card-1',
  payment_option: 'MasterCard',
  confirmation_code: 'CONFIRM-1',
  posting_status_description: 'Success',
};

function notification(overrides: Record<string, unknown> = {}) {
  return {
    id: 10463,
    amount: 150,
    payment_option: 'Visa',
    transaction_date: '2026-08-14T14:19:05.021Z',
    currency: 'KES',
    merchant_reference: 'attempt-card-1',
    confirmation_code: 'CONFIRM-1',
    ...overrides,
  };
}

function context() {
  return {
    headers: {
      consumerkey: 'merchant-key',
      consumersecret: 'merchant-secret',
    },
  };
}

describe('Pesapal Sabi provider', () => {
  beforeEach(() => {
    process.env.PESAPAL_SABI_WEBHOOK_CONSUMER_KEY = 'merchant-key';
    process.env.PESAPAL_SABI_WEBHOOK_CONSUMER_SECRET = 'merchant-secret';
    process.env.PESAPAL_SABI_API_KEY = 'api-key';
    process.env.PESAPAL_SABI_VERIFY_URL = 'https://example.test/verifytransaction';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(successVerification), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.PESAPAL_SABI_WEBHOOK_CONSUMER_KEY;
    delete process.env.PESAPAL_SABI_WEBHOOK_CONSUMER_SECRET;
    delete process.env.PESAPAL_SABI_API_KEY;
    delete process.env.PESAPAL_SABI_VERIFY_URL;
  });

  it('authenticates the notification and independently verifies success', async () => {
    const provider = new PesapalSabiProvider();
    const result = await provider.parseAndVerifyWebhook(notification(), context());

    expect(result).toMatchObject({
      providerEventKey: 'sabi:CONFIRM-1',
      paymentAttemptId: 'attempt-card-1',
      providerReference: 'CONFIRM-1',
      status: 'SUCCEEDED',
      amountMinor: 15000,
      currency: 'KES',
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://example.test/verifytransaction',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ APIKey: 'api-key' }),
        body: JSON.stringify({ confirmation_code: 'CONFIRM-1' }),
      }),
    );
  });

  it('rejects forged notification credentials before applying financial truth', async () => {
    const provider = new PesapalSabiProvider();
    await expect(
      provider.parseAndVerifyWebhook(notification(), {
        headers: { consumerkey: 'wrong', consumersecret: 'merchant-secret' },
      }),
    ).rejects.toThrow('Invalid Pesapal Sabi notification credentials');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('treats verification transport failure as UNKNOWN instead of false decline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')));
    const provider = new PesapalSabiProvider();
    const result = await provider.parseAndVerifyWebhook(notification(), context());

    expect(result.status).toBe('UNKNOWN');
    expect(result.failureCode).toBe('PESAPAL_SABI_VERIFY_TRANSPORT_ERROR');
    expect(result.providerReference).toBe('CONFIRM-1');
  });

  it('turns verification amount/reference mismatch into UNKNOWN', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ ...successVerification, amount: 200, merchant_ref: 'other-attempt' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    const provider = new PesapalSabiProvider();
    const result = await provider.parseAndVerifyWebhook(notification(), context());

    expect(result.status).toBe('UNKNOWN');
    expect(result.failureCode).toBe('PESAPAL_SABI_VERIFICATION_MISMATCH');
  });

  it('rejects prohibited raw card fields', async () => {
    const provider = new PesapalSabiProvider();
    await expect(
      provider.parseAndVerifyWebhook(notification({ cardNumber: '4111111111111111' }), context()),
    ).rejects.toThrow('Prohibited raw card field');
    expect(fetch).not.toHaveBeenCalled();
  });
});
