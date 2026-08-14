import { afterEach, describe, expect, it, vi } from 'vitest';
import { EdgePaymentsController } from '../src/payments/payments.controller';
import { EdgePaymentsService, parseEdgeInitiatePayment } from '../src/payments/payments.service';
import { DeviceEdgeAuthService } from '../src/security/device-edge-auth.service';
import {
  assertEdgeInitiatePaymentEnvelope,
  assertNoProhibitedEdgeCardFields,
  parseEdgeExternalTerminalConfirmation,
  TerminalPaymentsService,
} from '../src/payments/terminal-payments.service';

describe('Edge payment boundary', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CLOUD_API_URL;
  });

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

  it('normalizes a card-terminal initiation without cardholder credentials', () => {
    const request = parseEdgeInitiatePayment({
      eventId: 'event-1',
      paymentId: 'payment-card-1',
      paymentAttemptId: 'attempt-card-1',
      orderId: 'order-card-1',
      providerId: 'PESAPAL_SABI',
      idempotencyKey: 'PAYMENT:order-card-1:primary:attempt-card-1',
      amountMinor: 25000,
      currency: 'kes',
      accountReference: 'attempt-card-1',
    });

    expect(request.providerId).toBe('pesapal_sabi');
    expect(request.customerPhone).toBeUndefined();
    expect(JSON.stringify(request).toLowerCase()).not.toContain('cardnumber');
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

  it('rejects prohibited card credential fields before forwarding payment requests', () => {
    expect(() =>
      assertNoProhibitedEdgeCardFields({
        paymentAttemptId: 'attempt-card-1',
        terminalMetadata: { cardNumber: 'prohibited-value' },
      }),
    ).toThrow('Prohibited raw card field');
  });

  it('rejects unexpected payment initiation fields instead of forwarding arbitrary payload data', () => {
    expect(() =>
      assertEdgeInitiatePaymentEnvelope({
        eventId: 'event-1',
        paymentId: 'payment-card-1',
        paymentAttemptId: 'attempt-card-1',
        orderId: 'order-card-1',
        providerId: 'pesapal_sabi',
        idempotencyKey: 'PAYMENT:order-card-1:primary:attempt-card-1',
        amountMinor: 25000,
        currency: 'KES',
        accountReference: 'attempt-card-1',
        arbitraryTerminalBlob: 'not-part-of-contract',
      }),
    ).toThrow('Unexpected payment request field: arbitraryTerminalBlob');
  });

  it('rejects M-PESA phone data and wrong merchant references on Sabi at the authenticated Edge controller', async () => {
    const initiate = vi.fn();
    const deviceAuth = {
      authenticate: vi.fn(async () => ({
        deviceId: 'device-1',
        eventId: 'event-1',
        salesLocationId: null,
        registerId: null,
        credentialVersion: 1,
      })),
      authorizePaymentInitiation: vi.fn(),
    };
    const controller = new EdgePaymentsController(
      { initiate } as unknown as EdgePaymentsService,
      new TerminalPaymentsService(),
      deviceAuth as unknown as DeviceEdgeAuthService,
    );
    const cardRequest = {
      eventId: 'event-1',
      paymentId: 'payment-card-1',
      paymentAttemptId: 'attempt-card-1',
      orderId: 'order-card-1',
      providerId: 'pesapal_sabi',
      idempotencyKey: 'PAYMENT:order-card-1:primary:attempt-card-1',
      amountMinor: 25000,
      currency: 'KES',
      accountReference: 'attempt-card-1',
    };

    await expect(
      controller.initiate({}, { ...cardRequest, customerPhone: '254700000000' }),
    ).rejects.toThrow('customerPhone is only accepted for the M-PESA provider');
    await expect(
      controller.initiate({}, { ...cardRequest, accountReference: 'order-card-1' }),
    ).rejects.toThrow('Pesapal Sabi accountReference must equal paymentAttemptId');
    expect(initiate).not.toHaveBeenCalled();
  });

  it('normalizes a controlled manual terminal confirmation without card data', () => {
    expect(
      parseEdgeExternalTerminalConfirmation({
        confirmationId: 'confirmation-1',
        paymentAttemptId: 'attempt-external-1',
        externalProviderId: 'BANK-TERMINAL',
        externalReference: 'receipt-1',
        amountMinor: 25000,
        currency: 'kes',
        outcome: 'approved',
        actorId: 'supervisor-1',
        reason: 'Standalone fallback',
        idempotencyKey: 'MANUAL:attempt-external-1:receipt-1',
      }),
    ).toMatchObject({
      externalProviderId: 'bank-terminal',
      currency: 'KES',
      outcome: 'APPROVED',
    });
  });

  it('reports payment rails degraded when Cloud payment health is unreachable', async () => {
    process.env.CLOUD_API_URL = 'http://localhost:3001';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('cloud offline')));
    const rails = await new TerminalPaymentsService().railAvailability();

    expect(rails).toEqual([
      {
        providerId: 'mpesa',
        status: 'DEGRADED',
        detailCode: 'EDGE_CLOUD_PAYMENT_HEALTH_UNAVAILABLE',
      },
      {
        providerId: 'pesapal_sabi',
        status: 'DEGRADED',
        detailCode: 'EDGE_CLOUD_PAYMENT_HEALTH_UNAVAILABLE',
      },
      {
        providerId: 'external_terminal',
        status: 'DEGRADED',
        detailCode: 'EDGE_CLOUD_PAYMENT_HEALTH_UNAVAILABLE',
      },
    ]);
  });
});
