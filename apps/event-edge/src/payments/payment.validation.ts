import { BadRequestException } from '@nestjs/common';
import type {
  InitiatePaymentRequest,
  PaymentAttemptSnapshot,
  PaymentAttemptState,
} from '@event-commerce/contracts';

const states = new Set<PaymentAttemptState>([
  'INITIATED',
  'PENDING',
  'SUCCESS',
  'FAILED',
  'EXPIRED',
  'UNKNOWN',
  'REVERSED',
]);

function object(value: unknown, label: string, external = false): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    const message = `${label} must be an object`;
    if (external) throw new BadRequestException(message);
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, external = false): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    const message = `${label} must be a non-empty string`;
    if (external) throw new BadRequestException(message);
    throw new Error(message);
  }
  return value.trim();
}

function nullableText(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  return text(value, label);
}

function safePositiveInteger(value: unknown, label: string, external = false): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    const message = `${label} must be a positive safe integer`;
    if (external) throw new BadRequestException(message);
    throw new Error(message);
  }
  return value as number;
}

export function normalizeEdgeMsisdn(value: unknown): string {
  const raw = text(value, 'payer.value', true).replace(/[\s()-]/g, '');
  const normalized = raw.startsWith('+') ? raw.slice(1) : raw;
  if (!/^2547\d{8}$/.test(normalized) && !/^2541\d{8}$/.test(normalized)) {
    throw new BadRequestException('payer.value must be a Kenyan mobile MSISDN in 254XXXXXXXXX format');
  }
  return normalized;
}

export function maskEdgeMsisdn(value: string): string {
  return `254****${value.slice(-4)}`;
}

export function parseEdgeInitiatePaymentRequest(value: unknown): InitiatePaymentRequest {
  const input = object(value, 'payment initiation body', true);
  const amountMinor = safePositiveInteger(input.amountMinor, 'amountMinor', true);
  const currency = text(input.currency, 'currency', true).toUpperCase();
  if (currency !== 'KES') throw new BadRequestException('M-PESA currently supports KES payments only');
  if (amountMinor % 100 !== 0) {
    throw new BadRequestException('M-PESA amountMinor must represent a whole KES amount');
  }
  if (input.provider !== 'MPESA') throw new BadRequestException('provider must be MPESA');
  const payer = object(input.payer, 'payer', true);
  if (payer.kind !== 'MSISDN') throw new BadRequestException('payer.kind must be MSISDN');
  return {
    eventId: text(input.eventId, 'eventId', true),
    orderId: text(input.orderId, 'orderId', true),
    paymentId: text(input.paymentId, 'paymentId', true),
    attemptId: text(input.attemptId, 'attemptId', true),
    clientAttemptId: text(input.clientAttemptId, 'clientAttemptId', true),
    idempotencyKey: text(input.idempotencyKey, 'idempotencyKey', true),
    provider: 'MPESA',
    amountMinor,
    currency,
    payer: { kind: 'MSISDN', value: normalizeEdgeMsisdn(payer.value) },
  };
}

export function parseCloudPaymentSnapshot(value: unknown): PaymentAttemptSnapshot {
  const input = object(value, 'Cloud payment attempt');
  const state = text(input.state, 'state') as PaymentAttemptState;
  if (!states.has(state)) throw new Error('Cloud payment attempt state is invalid');
  if (input.provider !== 'MPESA') throw new Error('Cloud payment provider is invalid');
  if (typeof input.reconciliationRequired !== 'boolean') {
    throw new Error('Cloud payment reconciliationRequired must be boolean');
  }
  const createdAt = text(input.createdAt, 'createdAt');
  const updatedAt = text(input.updatedAt, 'updatedAt');
  if (!Number.isFinite(Date.parse(createdAt)) || !Number.isFinite(Date.parse(updatedAt))) {
    throw new Error('Cloud payment timestamps are invalid');
  }
  return {
    paymentId: text(input.paymentId, 'paymentId'),
    attemptId: text(input.attemptId, 'attemptId'),
    clientAttemptId: text(input.clientAttemptId, 'clientAttemptId'),
    eventId: text(input.eventId, 'eventId'),
    orderId: text(input.orderId, 'orderId'),
    provider: 'MPESA',
    state,
    amountMinor: safePositiveInteger(input.amountMinor, 'amountMinor'),
    currency: text(input.currency, 'currency').toUpperCase(),
    maskedPayerReference: nullableText(input.maskedPayerReference, 'maskedPayerReference'),
    providerRequestId: nullableText(input.providerRequestId, 'providerRequestId'),
    providerReceiptReference: nullableText(
      input.providerReceiptReference,
      'providerReceiptReference',
    ),
    createdAt,
    updatedAt,
    reconciliationRequired: input.reconciliationRequired,
  };
}
