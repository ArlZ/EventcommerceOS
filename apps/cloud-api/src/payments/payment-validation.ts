import type {
  InitiatePaymentRequest,
  RefundPaymentRequest,
  ReversePaymentRequest,
} from '@event-commerce/contracts';

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

function positiveAmount(record: Record<string, unknown>): number {
  const amountMinor = record.amountMinor;
  if (!Number.isSafeInteger(amountMinor) || (amountMinor as number) <= 0) {
    throw new Error('amountMinor must be a positive safe integer');
  }
  return amountMinor as number;
}

function currency(record: Record<string, unknown>): string {
  const value = requiredString(record, 'currency').toUpperCase();
  if (!/^[A-Z]{3}$/.test(value)) throw new Error('currency must be a three-letter code');
  return value;
}

export function parseInitiatePaymentRequest(value: unknown): InitiatePaymentRequest {
  const record = object(value);
  const request: InitiatePaymentRequest = {
    eventId: requiredString(record, 'eventId'),
    paymentId: requiredString(record, 'paymentId'),
    paymentAttemptId: requiredString(record, 'paymentAttemptId'),
    orderId: requiredString(record, 'orderId'),
    providerId: requiredString(record, 'providerId').toLowerCase(),
    idempotencyKey: requiredString(record, 'idempotencyKey'),
    amountMinor: positiveAmount(record),
    currency: currency(record),
    accountReference: requiredString(record, 'accountReference'),
  };
  const customerPhone = optionalString(record, 'customerPhone');
  const description = optionalString(record, 'description');
  if (customerPhone !== undefined) request.customerPhone = customerPhone;
  if (description !== undefined) request.description = description;
  return request;
}

export function parseRefundPaymentRequest(value: unknown): RefundPaymentRequest {
  const record = object(value);
  const request: RefundPaymentRequest = {
    refundId: requiredString(record, 'refundId'),
    paymentId: requiredString(record, 'paymentId'),
    amountMinor: positiveAmount(record),
    currency: currency(record),
    reason: requiredString(record, 'reason'),
    requestingActorId: requiredString(record, 'requestingActorId'),
    idempotencyKey: requiredString(record, 'idempotencyKey'),
  };
  const approvingActorId = optionalString(record, 'approvingActorId');
  if (approvingActorId !== undefined) request.approvingActorId = approvingActorId;
  return request;
}

export function parseReversePaymentRequest(value: unknown): ReversePaymentRequest {
  const record = object(value);
  return {
    reversalId: requiredString(record, 'reversalId'),
    paymentId: requiredString(record, 'paymentId'),
    amountMinor: positiveAmount(record),
    currency: currency(record),
    reason: requiredString(record, 'reason'),
    requestingActorId: requiredString(record, 'requestingActorId'),
    idempotencyKey: requiredString(record, 'idempotencyKey'),
  };
}
