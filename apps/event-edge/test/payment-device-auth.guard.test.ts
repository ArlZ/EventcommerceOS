import type { ExecutionContext } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import { PaymentDeviceAuthGuard } from '../src/payments/payment-device-auth.guard';

function context(authorization?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: authorization ? { authorization } : {} }),
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

describe('PaymentDeviceAuthGuard', () => {
  const original = process.env.EDGE_PAYMENT_BEARER_TOKEN;

  afterEach(() => {
    if (original === undefined) delete process.env.EDGE_PAYMENT_BEARER_TOKEN;
    else process.env.EDGE_PAYMENT_BEARER_TOKEN = original;
  });

  it('fails closed when payment device authentication is not configured', () => {
    delete process.env.EDGE_PAYMENT_BEARER_TOKEN;
    expect(() => new PaymentDeviceAuthGuard().canActivate(context('Bearer anything'))).toThrow(
      /not configured/,
    );
  });

  it('rejects an incorrect POS payment credential', () => {
    process.env.EDGE_PAYMENT_BEARER_TOKEN = 'd'.repeat(40);
    expect(() => new PaymentDeviceAuthGuard().canActivate(context(`Bearer ${'e'.repeat(40)}`))).toThrow(
      /failed/,
    );
  });

  it('accepts the provisioned POS payment credential', () => {
    process.env.EDGE_PAYMENT_BEARER_TOKEN = 'f'.repeat(40);
    expect(new PaymentDeviceAuthGuard().canActivate(context(`Bearer ${'f'.repeat(40)}`))).toBe(true);
  });
});
