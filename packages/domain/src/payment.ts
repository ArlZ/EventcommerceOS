export const PAYMENT_ATTEMPT_STATES = [
  'INITIATED',
  'PENDING',
  'SUCCESS',
  'FAILED',
  'EXPIRED',
  'UNKNOWN',
  'REVERSED',
] as const;

export type PaymentAttemptState = (typeof PAYMENT_ATTEMPT_STATES)[number];

const ALLOWED_TRANSITIONS: Readonly<Record<PaymentAttemptState, readonly PaymentAttemptState[]>> = {
  INITIATED: ['PENDING', 'SUCCESS', 'FAILED', 'UNKNOWN'],
  PENDING: ['SUCCESS', 'FAILED', 'EXPIRED', 'UNKNOWN'],
  UNKNOWN: ['PENDING', 'SUCCESS', 'FAILED', 'EXPIRED'],
  SUCCESS: ['REVERSED'],
  FAILED: [],
  EXPIRED: [],
  REVERSED: [],
};

export function requirePaymentAttemptTransition(
  from: PaymentAttemptState,
  to: PaymentAttemptState,
): void {
  if (from === to) return;
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new Error(`invalid payment attempt transition ${from} -> ${to}`);
  }
}

export function isPaymentAttemptTerminal(state: PaymentAttemptState): boolean {
  return state === 'FAILED' || state === 'EXPIRED' || state === 'REVERSED';
}

export function requiresPaymentReconciliation(state: PaymentAttemptState): boolean {
  return state === 'INITIATED' || state === 'PENDING' || state === 'UNKNOWN';
}

export type PaymentRetryDisposition =
  | 'ALLOW_NEW_ATTEMPT'
  | 'BLOCK_UNRESOLVED'
  | 'BLOCK_SETTLED';

export function paymentRetryDisposition(
  attemptStates: readonly PaymentAttemptState[],
): PaymentRetryDisposition {
  if (attemptStates.some((state) => state === 'SUCCESS')) return 'BLOCK_SETTLED';
  if (attemptStates.some(requiresPaymentReconciliation)) return 'BLOCK_UNRESOLVED';
  return 'ALLOW_NEW_ATTEMPT';
}

export type WebhookVerificationStrength = 'CRYPTOGRAPHIC' | 'CORRELATION_ONLY' | 'NONE';

export interface PaymentProviderCapabilities {
  queryStatus: boolean;
  refund: boolean;
  reverse: boolean;
  webhookVerification: WebhookVerificationStrength;
}

export type ProviderObservationOutcome =
  | 'ACCEPTED_FOR_PROCESSING'
  | 'SUCCESS'
  | 'FAILED'
  | 'EXPIRED'
  | 'UNKNOWN';

export function providerOutcomeToAttemptState(
  outcome: ProviderObservationOutcome,
): PaymentAttemptState {
  switch (outcome) {
    case 'ACCEPTED_FOR_PROCESSING':
      return 'PENDING';
    case 'SUCCESS':
      return 'SUCCESS';
    case 'FAILED':
      return 'FAILED';
    case 'EXPIRED':
      return 'EXPIRED';
    case 'UNKNOWN':
      return 'UNKNOWN';
  }
}
