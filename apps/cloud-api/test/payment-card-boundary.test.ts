import { describe, expect, it } from 'vitest';
import {
  assertNoProhibitedCardFields,
  parseExternalTerminalConfirmation,
  parseInitiatePaymentRequest,
} from '../src/payments/payment-validation';

describe('payment card-data boundary', () => {
  const initiation = () => ({
    eventId: 'event-card',
    paymentId: 'payment-card',
    paymentAttemptId: 'attempt-card',
    orderId: 'order-card',
    providerId: 'pesapal_sabi',
    idempotencyKey: 'PAYMENT:order-card:primary:client-card',
    amountMinor: 15000,
    currency: 'KES',
    accountReference: 'attempt-card',
  });

  it.each([
    ['cardNumber', 'prohibited-value'],
    ['pan', 'prohibited-value'],
    ['cvv', 'prohibited-value'],
    ['pin', 'prohibited-value'],
    ['track2', 'prohibited-value'],
    ['emv', { blob: 'prohibited-value' }],
  ])('rejects prohibited field %s before it becomes an application payment request', (key, value) => {
    expect(() => parseInitiatePaymentRequest({ ...initiation(), [key]: value })).toThrow(
      'Prohibited raw card field',
    );
  });

  it('rejects prohibited card fields nested inside arbitrary external payloads', () => {
    expect(() =>
      assertNoProhibitedCardFields({ terminal: { metadata: { cvc: 'prohibited-value' } } }),
    ).toThrow('Prohibited raw card field');
  });

  it('keeps valid terminal initiation and manual-confirmation models reference-only', () => {
    const request = parseInitiatePaymentRequest(initiation());
    const manual = parseExternalTerminalConfirmation({
      confirmationId: 'confirmation-1',
      paymentAttemptId: 'attempt-external-1',
      externalProviderId: 'bank-terminal',
      externalReference: 'receipt-1',
      amountMinor: 15000,
      currency: 'KES',
      outcome: 'APPROVED',
      actorId: 'supervisor-1',
      reason: 'Standalone terminal fallback',
      idempotencyKey: 'MANUAL:attempt-external-1:receipt-1',
    });

    const serialized = `${JSON.stringify(request)}${JSON.stringify(manual)}`.toLowerCase();
    for (const prohibited of [
      '"pan"',
      'cardnumber',
      '"cvv"',
      '"cvc"',
      '"pin"',
      'track1',
      'track2',
      'magstripe',
      'cryptogram',
    ]) {
      expect(serialized).not.toContain(prohibited);
    }
  });
});
