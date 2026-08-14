import { describe, expect, it } from 'vitest';
import {
  assertPaymentAttemptTransition,
  buildPaymentIdempotencyKey,
  canTransitionPaymentAttempt,
  paymentAttemptIsTerminal,
  paymentAttemptNeedsReconciliation,
  stateAfterProviderTimeout,
} from '../src';

describe('payment attempt state machine', () => {
  it('allows provider truth to resolve an unknown attempt', () => {
    expect(canTransitionPaymentAttempt('UNKNOWN', 'SUCCEEDED')).toBe(true);
    expect(canTransitionPaymentAttempt('UNKNOWN', 'FAILED')).toBe(true);
  });

  it('does not allow terminal outcomes to be silently overwritten', () => {
    expect(canTransitionPaymentAttempt('SUCCEEDED', 'FAILED')).toBe(false);
    expect(() => assertPaymentAttemptTransition('FAILED', 'SUCCEEDED')).toThrow(
      'Invalid payment attempt transition',
    );
  });

  it('treats same-state replay as idempotent', () => {
    expect(canTransitionPaymentAttempt('PENDING', 'PENDING')).toBe(true);
    expect(() => assertPaymentAttemptTransition('UNKNOWN', 'UNKNOWN')).not.toThrow();
  });

  it('maps provider timeout to unknown instead of false failure', () => {
    expect(stateAfterProviderTimeout('INITIATED')).toBe('UNKNOWN');
    expect(stateAfterProviderTimeout('PENDING')).toBe('UNKNOWN');
    expect(paymentAttemptNeedsReconciliation('UNKNOWN')).toBe(true);
  });

  it('keeps terminal states terminal on later transport timeout', () => {
    expect(stateAfterProviderTimeout('SUCCEEDED')).toBe('SUCCEEDED');
    expect(stateAfterProviderTimeout('FAILED')).toBe('FAILED');
    expect(paymentAttemptIsTerminal('SUCCEEDED')).toBe(true);
  });
});

describe('payment idempotency', () => {
  it('builds a stable key from order, slot and client attempt', () => {
    expect(
      buildPaymentIdempotencyKey({
        orderId: 'order-1',
        paymentSlot: 'primary',
        clientAttemptId: 'attempt-7',
      }),
    ).toBe('PAYMENT:order-1:primary:attempt-7');
  });

  it('rejects incomplete key components', () => {
    expect(() =>
      buildPaymentIdempotencyKey({ orderId: 'order-1', paymentSlot: '', clientAttemptId: 'x' }),
    ).toThrow('Payment idempotency components must not be empty');
  });
});
