import type { Money } from './money';

export const PAYMENT_ATTEMPT_STATES = [
  'CREATED',
  'INITIATED',
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'UNKNOWN',
] as const;

export type PaymentAttemptState = (typeof PAYMENT_ATTEMPT_STATES)[number];

export type PaymentProviderId = string & { readonly __paymentProviderId: unique symbol };
export type PaymentIdempotencyKey = string & { readonly __paymentIdempotencyKey: unique symbol };

export interface PaymentAttemptSnapshot {
  id: string;
  paymentId: string;
  orderId: string;
  providerId: PaymentProviderId;
  idempotencyKey: PaymentIdempotencyKey;
  amount: Money;
  state: PaymentAttemptState;
  providerReference?: string;
  failureCode?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentProviderCapabilities {
  queryStatus: boolean;
  refunds: boolean;
  reversals: boolean;
  asynchronousCallbacks: boolean;
}

export interface RefundRecord {
  id: string;
  paymentId: string;
  amount: Money;
  reason: string;
  requestingActorId: string;
  approvingActorId?: string;
  providerReference?: string;
  idempotencyKey: PaymentIdempotencyKey;
  status: 'REQUESTED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
  createdAt: string;
  updatedAt: string;
}

export interface ReversalRecord {
  id: string;
  paymentId: string;
  amount: Money;
  reason: string;
  requestingActorId: string;
  providerReference?: string;
  idempotencyKey: PaymentIdempotencyKey;
  status: 'REQUESTED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
  createdAt: string;
  updatedAt: string;
}

const ALLOWED_TRANSITIONS: Readonly<Record<PaymentAttemptState, readonly PaymentAttemptState[]>> = {
  CREATED: ['INITIATED', 'PENDING', 'FAILED', 'UNKNOWN'],
  INITIATED: ['PENDING', 'SUCCEEDED', 'FAILED', 'UNKNOWN'],
  PENDING: ['SUCCEEDED', 'FAILED', 'UNKNOWN'],
  UNKNOWN: ['PENDING', 'SUCCEEDED', 'FAILED'],
  SUCCEEDED: [],
  FAILED: [],
};

export function asPaymentProviderId(value: string): PaymentProviderId {
  const normalized = value.trim().toLowerCase();
  if (!normalized) throw new Error('Payment provider identifier must not be empty');
  return normalized as PaymentProviderId;
}

export function asPaymentIdempotencyKey(value: string): PaymentIdempotencyKey {
  const normalized = value.trim();
  if (!normalized) throw new Error('Payment idempotency key must not be empty');
  return normalized as PaymentIdempotencyKey;
}

export function buildPaymentIdempotencyKey(input: {
  orderId: string;
  paymentSlot: string;
  clientAttemptId: string;
}): PaymentIdempotencyKey {
  const orderId = input.orderId.trim();
  const paymentSlot = input.paymentSlot.trim();
  const clientAttemptId = input.clientAttemptId.trim();
  if (!orderId || !paymentSlot || !clientAttemptId) {
    throw new Error('Payment idempotency components must not be empty');
  }
  return asPaymentIdempotencyKey(`PAYMENT:${orderId}:${paymentSlot}:${clientAttemptId}`);
}

export function canTransitionPaymentAttempt(
  from: PaymentAttemptState,
  to: PaymentAttemptState,
): boolean {
  return from === to || ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertPaymentAttemptTransition(
  from: PaymentAttemptState,
  to: PaymentAttemptState,
): void {
  if (!canTransitionPaymentAttempt(from, to)) {
    throw new Error(`Invalid payment attempt transition: ${from} -> ${to}`);
  }
}

export function paymentAttemptNeedsReconciliation(state: PaymentAttemptState): boolean {
  return state === 'UNKNOWN';
}

export function paymentAttemptIsTerminal(state: PaymentAttemptState): boolean {
  return state === 'SUCCEEDED' || state === 'FAILED';
}

export function stateAfterProviderTimeout(current: PaymentAttemptState): PaymentAttemptState {
  if (paymentAttemptIsTerminal(current)) return current;
  return 'UNKNOWN';
}
