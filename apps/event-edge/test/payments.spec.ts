import { describe, expect, it } from 'vitest';
import { parseEdgeInitiatePayment } from '../src/payments/payments.service';

describe('Edge payment boundary', () => {
  it('normalizes a transient M-PESA initiation request', () => {
    expect(
      parseEdgeInitiatePayment({
        eventId: 'event-1',
        paymentId: 'payment-1',
        paymentAttemptId: 'attempt-1',
        orderId: 'order-1',
        providerId: 'MPESA',
        idempotencyKey: 'PAYMENT:order-1:primary:attempt-1',
        amountMinor: 25000,
        currency: 'kes',
        customerPhone: '254700000000',
        accountReference: 'order-1',
      }),
    ).toMatchObject({
      providerId: 'mpesa',
      amountMinor: 25000,
      currency: 'KES',
      customerPhone: '254700000000',
    });
  });

  it('rejects floating point money at the Edge boundary', () => {
    expect(() =>
      parseEdgeInitiatePayment({
        eventId: 'event-1',
        paymentId: 'payment-1',
        paymentAttemptId: 'attempt-1',
        orderId: 'order-1',
        providerId: 'mpesa',
        idempotencyKey: 'key',
        amountMinor: 99.5,
        currency: 'KES',
        accountReference: 'order-1',
      }),
    ).toThrow('amountMinor must be a positive safe integer');
  });
});
