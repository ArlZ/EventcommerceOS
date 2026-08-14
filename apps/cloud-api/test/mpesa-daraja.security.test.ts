import { describe, expect, it } from 'vitest';
import { MpesaDarajaProvider } from '../src/payments/mpesa-daraja.provider';

const baseEnvironment: NodeJS.ProcessEnv = {
  MPESA_ENVIRONMENT: 'sandbox',
  MPESA_BASE_URL: 'https://daraja.test',
  MPESA_CONSUMER_KEY: 'consumer-key',
  MPESA_CONSUMER_SECRET: 'consumer-secret',
  MPESA_SHORTCODE: '174379',
  MPESA_PASSKEY: 'sandbox-passkey',
  MPESA_CALLBACK_URL: 'https://example.test/payments/webhooks/mpesa',
};

const input = {
  attemptId: 'attempt-security-001',
  amountMinor: 25_000,
  currency: 'KES',
  accountReference: 'order-security-001',
  payer: { kind: 'MSISDN' as const, value: '254712345678' },
};

describe('M-PESA transport security configuration', () => {
  it('refuses a non-HTTPS Daraja base URL before consumer credentials can be transmitted', async () => {
    let calls = 0;
    const provider = new MpesaDarajaProvider(
      { ...baseEnvironment, MPESA_BASE_URL: 'http://daraja.test' },
      async () => {
        calls += 1;
        return new Response('{}');
      },
    );

    await expect(provider.initiate(input)).resolves.toMatchObject({
      outcome: 'FAILED',
      reasonCode: 'PROVIDER_CONFIGURATION_MISSING',
    });
    expect(calls).toBe(0);
  });

  it('refuses a non-HTTPS callback URL before requesting an OAuth token', async () => {
    let calls = 0;
    const provider = new MpesaDarajaProvider(
      { ...baseEnvironment, MPESA_CALLBACK_URL: 'http://example.test/payments/webhooks/mpesa' },
      async () => {
        calls += 1;
        return new Response('{}');
      },
    );

    await expect(provider.initiate(input)).resolves.toMatchObject({
      outcome: 'FAILED',
      reasonCode: 'PROVIDER_CONFIGURATION_MISSING',
    });
    expect(calls).toBe(0);
  });
});
