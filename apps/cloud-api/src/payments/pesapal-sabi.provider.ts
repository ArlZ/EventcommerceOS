import { timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type {
  PaymentProvider,
  ProviderAvailability,
  ProviderInitiationRequest,
  ProviderInitiationResult,
  ProviderStatusResult,
  ProviderWebhookContext,
  VerifiedProviderCallback,
} from './payment-provider';

interface SabiConfig {
  consumerKey: string;
  consumerSecret: string;
  apiKey: string;
  verificationUrl: string;
  timeoutMs: number;
}

interface SabiVerificationResponse {
  amount?: number;
  posting_status?: number;
  status?: number;
  status_description?: string;
  currency?: string;
  merchant_ref?: string;
  payment_option?: string;
  confirmation_code?: string;
  posting_status_description?: string;
}

const PROHIBITED_CARD_KEYS = new Set([
  'pan',
  'cardnumber',
  'cvv',
  'cvc',
  'pin',
  'track1',
  'track2',
  'trackdata',
  'magstripe',
  'emv',
  'cryptogram',
]);

function parseObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Pesapal Sabi payload');
  }
  return value as Record<string, unknown>;
}

function text(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Pesapal Sabi payload missing ${key}`);
  }
  return value.trim();
}

function assertNoProhibitedCardData(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertNoProhibitedCardData);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (PROHIBITED_CARD_KEYS.has(normalized)) {
      throw new Error(`Prohibited raw card field received: ${key}`);
    }
    assertNoProhibitedCardData(child);
  }
}

function header(context: ProviderWebhookContext | undefined, name: string): string | undefined {
  if (!context) return undefined;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(context.headers)) {
    if (key.toLowerCase() !== wanted) continue;
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value[0];
  }
  return undefined;
}

function secureEqual(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function minorUnits(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Invalid Pesapal Sabi amount');
  const minor = Math.round(amount * 100);
  if (!Number.isSafeInteger(minor) || Math.abs(amount * 100 - minor) > 1e-7) {
    throw new Error('Pesapal Sabi amount cannot be represented in minor units');
  }
  return minor;
}

function isDocumentedCardOption(value: string): boolean {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '');
  return normalized === 'visa' || normalized === 'mastercard';
}

@Injectable()
export class PesapalSabiProvider implements PaymentProvider {
  readonly id = 'pesapal_sabi';

  capabilities() {
    return {
      queryStatus: true,
      refunds: false,
      reversals: false,
      asynchronousCallbacks: true,
    } as const;
  }

  availability(): ProviderAvailability {
    const configured = [
      'PESAPAL_SABI_WEBHOOK_CONSUMER_KEY',
      'PESAPAL_SABI_WEBHOOK_CONSUMER_SECRET',
      'PESAPAL_SABI_API_KEY',
    ].every((name) => Boolean(process.env[name]?.trim()));
    return configured
      ? { status: 'AVAILABLE', detailCode: 'SABI_WIRELESS_CONFIGURED' }
      : { status: 'UNCONFIGURED', detailCode: 'SABI_WIRELESS_CREDENTIALS_MISSING' };
  }

  async initiate(request: ProviderInitiationRequest): Promise<ProviderInitiationResult> {
    if (!Number.isSafeInteger(request.amountMinor) || request.amountMinor <= 0) {
      return { status: 'FAILED', failureCode: 'INVALID_AMOUNT' };
    }
    if (!/^[A-Z]{3}$/.test(request.currency)) {
      return { status: 'FAILED', failureCode: 'INVALID_CURRENCY' };
    }

    // The public Sabi wireless API is terminal-originated. The POS displays this immutable
    // paymentAttemptId as the merchant reference; no undocumented wired command is invented here.
    return {
      status: 'PENDING',
      failureCode: 'AWAITING_SABI_TERMINAL',
      providerRequestId: request.paymentAttemptId,
    };
  }

  async queryStatus(providerReference: string): Promise<ProviderStatusResult> {
    return this.verify(providerReference);
  }

  async parseAndVerifyWebhook(
    payload: unknown,
    context?: ProviderWebhookContext,
  ): Promise<VerifiedProviderCallback> {
    assertNoProhibitedCardData(payload);
    const config = this.config();
    if (
      !secureEqual(header(context, 'consumerkey'), config.consumerKey) ||
      !secureEqual(header(context, 'consumersecret'), config.consumerSecret)
    ) {
      throw new Error('Invalid Pesapal Sabi notification credentials');
    }

    const notification = parseObject(payload);
    const paymentOption = text(notification, 'payment_option');
    if (!isDocumentedCardOption(paymentOption)) {
      throw new Error('Pesapal Sabi notification is not a supported card transaction');
    }

    const merchantReference = text(notification, 'merchant_reference');
    const confirmationCode = text(notification, 'confirmation_code');
    const currency = text(notification, 'currency').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Invalid Pesapal Sabi currency');
    const rawAmount = notification.amount;
    if (typeof rawAmount !== 'number') throw new Error('Pesapal Sabi payload missing numeric amount');
    const notificationAmountMinor = minorUnits(rawAmount);

    const verified = await this.verify(confirmationCode);
    const verificationMismatch =
      (verified.paymentAttemptId !== undefined && verified.paymentAttemptId !== merchantReference) ||
      (verified.amountMinor !== undefined && verified.amountMinor !== notificationAmountMinor) ||
      (verified.currency !== undefined && verified.currency !== currency);

    return {
      providerEventKey: `sabi:${confirmationCode}`,
      paymentAttemptId: merchantReference,
      providerReference: confirmationCode,
      status: verificationMismatch ? 'UNKNOWN' : verified.status,
      amountMinor: verified.amountMinor ?? notificationAmountMinor,
      currency: verified.currency ?? currency,
      failureCode: verificationMismatch
        ? 'PESAPAL_SABI_VERIFICATION_MISMATCH'
        : verified.failureCode,
    };
  }

  private config(): SabiConfig {
    const timeoutMs = Number(process.env.PESAPAL_SABI_TIMEOUT_MS ?? '10000');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new Error('PESAPAL_SABI_TIMEOUT_MS must be a positive integer');
    }
    return {
      consumerKey: this.required('PESAPAL_SABI_WEBHOOK_CONSUMER_KEY'),
      consumerSecret: this.required('PESAPAL_SABI_WEBHOOK_CONSUMER_SECRET'),
      apiKey: this.required('PESAPAL_SABI_API_KEY'),
      verificationUrl:
        process.env.PESAPAL_SABI_VERIFY_URL?.trim() ||
        'https://ext.pesapal.com/api/transactions/verifytransaction',
      timeoutMs,
    };
  }

  private required(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`Missing required Pesapal Sabi configuration: ${name}`);
    return value;
  }

  private async verify(confirmationCode: string): Promise<ProviderStatusResult> {
    const config = this.config();
    try {
      const response = await fetch(config.verificationUrl, {
        method: 'POST',
        headers: {
          APIKey: config.apiKey,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ confirmation_code: confirmationCode }),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      if (!response.ok) {
        return {
          status: 'UNKNOWN',
          providerReference: confirmationCode,
          failureCode: `PESAPAL_SABI_VERIFY_HTTP_${response.status}`,
        };
      }

      const body = (await response.json()) as SabiVerificationResponse;
      if (body.confirmation_code !== confirmationCode) {
        return {
          status: 'UNKNOWN',
          providerReference: confirmationCode,
          failureCode: 'PESAPAL_SABI_CONFIRMATION_MISMATCH',
        };
      }

      const amountMinor = typeof body.amount === 'number' ? minorUnits(body.amount) : undefined;
      const currency =
        typeof body.currency === 'string' && /^[A-Za-z]{3}$/.test(body.currency)
          ? body.currency.toUpperCase()
          : undefined;
      const paymentAttemptId =
        typeof body.merchant_ref === 'string' && body.merchant_ref.trim()
          ? body.merchant_ref.trim()
          : undefined;
      const completed =
        body.status === 1 &&
        body.posting_status === 0 &&
        body.status_description?.trim().toLowerCase() === 'completed' &&
        body.posting_status_description?.trim().toLowerCase() === 'success';

      return {
        status: completed ? 'SUCCEEDED' : 'UNKNOWN',
        providerReference: confirmationCode,
        ...(paymentAttemptId ? { paymentAttemptId } : {}),
        ...(amountMinor !== undefined ? { amountMinor } : {}),
        ...(currency ? { currency } : {}),
        ...(!completed ? { failureCode: 'PESAPAL_SABI_STATUS_UNPROVEN' } : {}),
      };
    } catch {
      return {
        status: 'UNKNOWN',
        providerReference: confirmationCode,
        failureCode: 'PESAPAL_SABI_VERIFY_TRANSPORT_ERROR',
      };
    }
  }
}
