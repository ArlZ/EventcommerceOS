import type { ExecutionContext } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import { PaymentEdgeAuthGuard } from '../src/payments/payment-edge-auth.guard';

function context(authorization?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: authorization ? { authorization } : {} }),
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

describe('PaymentEdgeAuthGuard', () => {
  const original = process.env.CLOUD_API_BEARER_TOKEN;

  afterEach(() => {
    if (original === undefined) delete process.env.CLOUD_API_BEARER_TOKEN;
    else process.env.CLOUD_API_BEARER_TOKEN = original;
  });

  it('rejects payment operations when Cloud payment authentication is not provisioned', () => {
    delete process.env.CLOUD_API_BEARER_TOKEN;
    expect(() => new PaymentEdgeAuthGuard().canActivate(context('Bearer anything'))).toThrow(
      /not configured/,
    );
  });

  it('rejects missing and incorrect Edge credentials', () => {
    process.env.CLOUD_API_BEARER_TOKEN = 'a'.repeat(40);
    expect(() => new PaymentEdgeAuthGuard().canActivate(context())).toThrow(/required/);
    expect(() => new PaymentEdgeAuthGuard().canActivate(context(`Bearer ${'b'.repeat(40)}`))).toThrow(
      /failed/,
    );
  });

  it('accepts only the provisioned Edge credential', () => {
    process.env.CLOUD_API_BEARER_TOKEN = 'c'.repeat(40);
    expect(new PaymentEdgeAuthGuard().canActivate(context(`Bearer ${'c'.repeat(40)}`))).toBe(true);
  });
});
