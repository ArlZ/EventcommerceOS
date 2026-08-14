import type { InitiatePaymentRequest } from '@event-commerce/contracts';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Payment request must be an object');
  }
  return value as Record<string, unknown>;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${key} must be a non-empty string when provided`);
  }
  return value.trim();
}

export function parseInitiatePaymentRequest(value: unknown): InitiatePaymentRequest {
  const record = object(value);
  const amountMinor = record.amountMinor;
  if (!Number.isSafeInteger(amountMinor) || (amountMinor as number) <= 0) {
    throw new Error('amountMinor must be a positive safe integer');
  }

  const currency = requiredString(record, 'currency').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('currency must be a three-letter code');

  const request: InitiatePaymentRequest = {
    eventId: requiredString(record, 'eventId'),
    paymentId: requiredString(record, 'paymentId'),
    paymentAttemptId: requiredString(record, 'paymentAttemptId'),
    orderId: requiredString(record, 'orderId'),
    providerId: requiredString(record, 'providerId').toLowerCase(),
    idempotencyKey: requiredString(record, 'idempotencyKey'),
    amountMinor: amountMinor as number,
    currency,
    accountReference: requiredString(record, 'accountReference'),
  };
  const customerPhone = optionalString(record, 'customerPhone');
  const description = optionalString(record, 'description');
  if (customerPhone !== undefined) request.customerPhone = customerPhone;
  if (description !== undefined) request.description = description;
  return request;
}
