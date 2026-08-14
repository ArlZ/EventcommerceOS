import { describe, expect, it } from 'vitest';
import {
  isPaymentAttemptTerminal,
  paymentRetryDisposition,
  providerOutcomeToAttemptState,
  requirePaymentAttemptTransition,
  requiresPaymentReconciliation,
} from '../src/payment';

describe('payment attempt state machine', () => {
  it('keeps ambiguous provider truth reconcilable instead of treating it as failure', () => {
    expect(() => requirePaymentAttemptTransition('INITIATED', 'UNKNOWN')).not.toThrow();
    expect(() => requirePaymentAttemptTransition('PENDING', 'UNKNOWN')).not.toThrow();
    expect(() => requirePaymentAttemptTransition('UNKNOWN', 'SUCCESS')).not.toThrow();
    expect(() => requirePaymentAttemptTransition('UNKNOWN', 'FAILED')).not.toThrow();
    expect(requiresPaymentReconciliation('UNKNOWN')).toBe(true);
    expect(isPaymentAttemptTerminal('UNKNOWN')).toBe(false);
  });

  it('rejects transitions that would rewrite terminal attempt history', () => {
    expect(() => requirePaymentAttemptTransition('FAILED', 'PENDING')).toThrow(
      /invalid payment attempt transition/,
    );
    expect(() => requirePaymentAttemptTransition('EXPIRED', 'SUCCESS')).toThrow(
      /invalid payment attempt transition/,
    );
    expect(() => requirePaymentAttemptTransition('REVERSED', 'SUCCESS')).toThrow(
      /invalid payment attempt transition/,
    );
  });

  it('allows an explicit reversal only from success', () => {
    expect(() => requirePaymentAttemptTransition('SUCCESS', 'REVERSED')).not.toThrow();
    expect(() => requirePaymentAttemptTransition('PENDING', 'REVERSED')).toThrow(
      /invalid payment attempt transition/,
    );
  });
});

describe('payment retry policy', () => {
  it('blocks a second charge while provider truth is unresolved', () => {
    expect(paymentRetryDisposition(['INITIATED'])).toBe('BLOCK_UNRESOLVED');
    expect(paymentRetryDisposition(['PENDING'])).toBe('BLOCK_UNRESOLVED');
    expect(paymentRetryDisposition(['UNKNOWN'])).toBe('BLOCK_UNRESOLVED');
    expect(paymentRetryDisposition(['FAILED', 'UNKNOWN'])).toBe('BLOCK_UNRESOLVED');
  });

  it('blocks retry after a successful settlement and allows a new attempt after terminal failure', () => {
    expect(paymentRetryDisposition(['FAILED'])).toBe('ALLOW_NEW_ATTEMPT');
    expect(paymentRetryDisposition(['EXPIRED'])).toBe('ALLOW_NEW_ATTEMPT');
    expect(paymentRetryDisposition(['REVERSED'])).toBe('ALLOW_NEW_ATTEMPT');
    expect(paymentRetryDisposition(['FAILED', 'SUCCESS'])).toBe('BLOCK_SETTLED');
  });
});

describe('normalized provider outcomes', () => {
  it('maps accepted-for-processing to pending rather than success', () => {
    expect(providerOutcomeToAttemptState('ACCEPTED_FOR_PROCESSING')).toBe('PENDING');
    expect(providerOutcomeToAttemptState('UNKNOWN')).toBe('UNKNOWN');
    expect(providerOutcomeToAttemptState('SUCCESS')).toBe('SUCCESS');
  });
});
