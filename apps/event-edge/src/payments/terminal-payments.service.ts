import { Injectable } from '@nestjs/common';
import type {
  ConfirmExternalTerminalPaymentRequest,
  ExternalTerminalConfirmationView,
  PaymentRailAvailabilityStatus,
  PaymentRailAvailabilityView,
} from '@event-commerce/contracts';

const PROHIBITED_CARD_KEYS = new Set([
  'pan',
  'cardnumber',
  'cvv',
  'cvc',
  'pin',
  'track',
  'track1',
  'track2',
  'trackdata',
  'magstripe',
  'emv',
  'cryptogram',
  'expiry',
  'expirationdate',
  'cardexpiry',
]);

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('terminal payment payload must be an object');
  }
  return value as Record<string, unknown>;
}

function text(value: Record<string, unknown>, key: string): string {
  const candidate = value[key];
  if (typeof candidate !== 'string' || !candidate.trim()) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return candidate.trim();
}

function positiveAmount(value: Record<string, unknown>): number {
  const amount = value.amountMinor;
  if (!Number.isSafeInteger(amount) || (amount as number) <= 0) {
    throw new Error('amountMinor must be a positive safe integer');
  }
  return amount as number;
}

function currency(value: Record<string, unknown>): string {
  const code = text(value, 'currency').toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new Error('currency must be a three-letter code');
  return code;
}

function assertNoProhibitedCardFields(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertNoProhibitedCardFields);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (PROHIBITED_CARD_KEYS.has(normalized)) {
      throw new Error(`Prohibited raw card field is not accepted: ${key}`);
    }
    assertNoProhibitedCardFields(child);
  }
}

export function parseEdgeExternalTerminalConfirmation(
  value: unknown,
): ConfirmExternalTerminalPaymentRequest {
  assertNoProhibitedCardFields(value);
  const input = record(value);
  const outcome = text(input, 'outcome').toUpperCase();
  if (outcome !== 'APPROVED' && outcome !== 'DECLINED') {
    throw new Error('outcome must be APPROVED or DECLINED');
  }
  return {
    confirmationId: text(input, 'confirmationId'),
    paymentAttemptId: text(input, 'paymentAttemptId'),
    externalProviderId: text(input, 'externalProviderId').toLowerCase(),
    externalReference: text(input, 'externalReference'),
    amountMinor: positiveAmount(input),
    currency: currency(input),
    outcome,
    actorId: text(input, 'actorId'),
    reason: text(input, 'reason'),
    idempotencyKey: text(input, 'idempotencyKey'),
  };
}

@Injectable()
export class TerminalPaymentsService {
  async confirmExternalTerminal(
    request: ConfirmExternalTerminalPaymentRequest,
  ): Promise<ExternalTerminalConfirmationView> {
    const response = await fetch(this.cloudUrl('/payments/manual-terminal-confirmations'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.timeoutMs()),
    });
    if (!response.ok) {
      throw new Error(`cloud manual terminal confirmation returned HTTP ${response.status}`);
    }
    return this.parseConfirmation(await response.json());
  }

  async railAvailability(): Promise<PaymentRailAvailabilityView[]> {
    try {
      const response = await fetch(this.cloudUrl('/payments/providers/availability'), {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs()),
      });
      if (!response.ok) throw new Error(`cloud payment rail health returned HTTP ${response.status}`);
      const body = await response.json();
      if (!Array.isArray(body)) throw new Error('cloud payment rail health must be an array');
      return body.map((item) => this.parseRail(item));
    } catch {
      return ['mpesa', 'pesapal_sabi', 'external_terminal'].map((providerId) => ({
        providerId,
        status: 'DEGRADED' as const,
        detailCode: 'EDGE_CLOUD_PAYMENT_HEALTH_UNAVAILABLE',
      }));
    }
  }

  private parseConfirmation(value: unknown): ExternalTerminalConfirmationView {
    assertNoProhibitedCardFields(value);
    const input = record(value);
    const outcome = text(input, 'outcome').toUpperCase();
    if (outcome !== 'APPROVED' && outcome !== 'DECLINED') {
      throw new Error('cloud returned invalid terminal outcome');
    }
    const createdAt = text(input, 'createdAt');
    if (!Number.isFinite(Date.parse(createdAt))) throw new Error('cloud returned invalid createdAt');
    return {
      confirmationId: text(input, 'confirmationId'),
      paymentAttemptId: text(input, 'paymentAttemptId'),
      eventId: text(input, 'eventId'),
      orderId: text(input, 'orderId'),
      externalProviderId: text(input, 'externalProviderId'),
      externalReference: text(input, 'externalReference'),
      amountMinor: positiveAmount(input),
      currency: currency(input),
      outcome,
      actorId: text(input, 'actorId'),
      reason: text(input, 'reason'),
      idempotencyKey: text(input, 'idempotencyKey'),
      createdAt,
    };
  }

  private parseRail(value: unknown): PaymentRailAvailabilityView {
    const input = record(value);
    const status = text(input, 'status') as PaymentRailAvailabilityStatus;
    if (!['AVAILABLE', 'UNCONFIGURED', 'DEGRADED'].includes(status)) {
      throw new Error('cloud returned invalid payment rail availability status');
    }
    const detail = input.detailCode;
    if (detail !== null && typeof detail !== 'string') {
      throw new Error('cloud returned invalid payment rail detailCode');
    }
    return {
      providerId: text(input, 'providerId'),
      status,
      detailCode: detail as string | null,
    };
  }

  private cloudUrl(path: string): string {
    const base = (process.env.CLOUD_API_URL ?? 'http://localhost:3001').replace(/\/$/, '');
    const parsed = new URL(base);
    const loopback =
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '::1';
    if (parsed.protocol !== 'https:' && !loopback) {
      throw new Error('Cloud API URL must use HTTPS outside loopback development');
    }
    return `${base}${path}`;
  }

  private timeoutMs(): number {
    const value = Number(process.env.CLOUD_PAYMENT_TIMEOUT_MS ?? '10000');
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error('CLOUD_PAYMENT_TIMEOUT_MS must be positive');
    }
    return value;
  }
}
