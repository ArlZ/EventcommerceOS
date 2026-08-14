import type { InitiatePaymentRequest } from '@event-commerce/contracts';

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

export function normalizeMsisdn(value: unknown): string {
  const raw = requiredString(value, 'payer.value').replace(/[\s()-]/g, '');
  const normalized = raw.startsWith('+') ? raw.slice(1) : raw;
  if (!/^2547\d{8}$/.test(normalized) && !/^2541\d{8}$/.test(normalized)) {
    throw new Error('payer.value must be a valid Kenyan mobile MSISDN in 254XXXXXXXXX format');
  }
  return normalized;
}

export function maskMsisdn(value: string): string {
  return `254****${value.slice(-4)}`;
}

export function parseInitiatePaymentRequest(value: unknown): InitiatePaymentRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('payment initiation body must be an object');
  }
  const input = value as Record<string, unknown>;
  const amountMinor = input.amountMinor;
  if (!Number.isSafeInteger(amountMinor) || (amountMinor as number) <= 0) {
    throw new Error('amountMinor must be a positive safe integer');
  }
  const currency = requiredString(input.currency, 'currency').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('currency must be a three-letter code');
  if (input.provider !== 'MPESA') throw new Error('provider must be MPESA');
  const payer = input.payer;
  if (!payer || typeof payer !== 'object' || Array.isArray(payer)) {
    throw new Error('payer must be an object');
  }
  const payerObject = payer as Record<string, unknown>;
  if (payerObject.kind !== 'MSISDN') throw new Error('payer.kind must be MSISDN');

  return {
    eventId: requiredString(input.eventId, 'eventId'),
    orderId: requiredString(input.orderId, 'orderId'),
    paymentId: requiredString(input.paymentId, 'paymentId'),
    clientAttemptId: requiredString(input.clientAttemptId, 'clientAttemptId'),
    idempotencyKey: requiredString(input.idempotencyKey, 'idempotencyKey'),
    provider: 'MPESA',
    amountMinor: amountMinor as number,
    currency,
    payer: { kind: 'MSISDN', value: normalizeMsisdn(payerObject.value) },
  };
}
