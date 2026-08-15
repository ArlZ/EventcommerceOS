import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  AbuseProtectionGuard,
  classifyAbuseRequest,
} from '../src/security/abuse-protection.guard';
import { AbuseProtectionService } from '../src/security/abuse-protection.service';

function requestContext(
  request: Record<string, unknown>,
  headers: Record<string, string>,
): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({
        setHeader(name: string, value: string) {
          headers[name] = value;
        },
      }),
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

describe('HTTP abuse protection', () => {
  it('depletes and continuously refills a token bucket', () => {
    const service = new AbuseProtectionService();
    const limit = service.policy('PUBLIC').requestsPerMinute;
    const now = 10_000;

    for (let index = 0; index < limit; index += 1) {
      expect(service.consume('PUBLIC', 'source:test', now).allowed).toBe(true);
    }
    const rejected = service.consume('PUBLIC', 'source:test', now);
    expect(rejected.allowed).toBe(false);
    expect(rejected.remaining).toBe(0);

    const refillMs = Math.ceil(60_000 / limit);
    expect(service.consume('PUBLIC', 'source:test', now + refillMs).allowed).toBe(true);
  });

  it('classifies high-throughput machine and provider routes separately from operators', () => {
    expect(
      classifyAbuseRequest({
        method: 'POST',
        path: '/sync/edge-events',
        headers: { authorization: 'Bearer edge-secret-value', 'x-edge-id': 'edge-a' },
      }),
    ).toMatchObject({ policy: 'EDGE_SYNC', principalType: 'edge' });

    expect(
      classifyAbuseRequest({
        method: 'POST',
        path: '/payments/initiate',
        headers: { authorization: 'Bearer edge-secret-value', 'x-edge-id': 'edge-a' },
      }),
    ).toMatchObject({ policy: 'EDGE_PAYMENT', principalType: 'edge' });

    expect(
      classifyAbuseRequest({
        method: 'POST',
        path: '/payments/providers/mpesa/callback',
        headers: {},
      }),
    ).toMatchObject({ policy: 'PROVIDER_CALLBACK', principalType: 'provider' });

    expect(
      classifyAbuseRequest({
        method: 'GET',
        path: '/command-centre/events/event-a',
        headers: { authorization: 'Bearer ecom_op_valid-looking-session-value-123456789' },
      }),
    ).toMatchObject({ policy: 'OPERATOR_READ', principalType: 'operator' });

    expect(
      classifyAbuseRequest({
        method: 'POST',
        path: '/event-close/events/event-a/close',
        headers: { authorization: 'Bearer ecom_op_valid-looking-session-value-123456789' },
      }),
    ).toMatchObject({ policy: 'OPERATOR_MUTATION', principalType: 'operator' });
  });

  it('never retains a raw bearer secret as the caller bucket key', () => {
    const secret = 'Bearer ecom_op_super-secret-token-value-12345678901234567890';
    const classified = classifyAbuseRequest({
      method: 'GET',
      path: '/command-centre/events/event-a',
      headers: { authorization: secret },
    });
    expect(classified?.principalKey).toBeDefined();
    expect(classified?.principalKey).not.toContain(secret);
    expect(classified?.principalKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns 429 with retry metadata after the source bucket is exhausted', () => {
    const service = new AbuseProtectionService();
    const guard = new AbuseProtectionGuard(service);
    const limit = service.policy('PUBLIC').requestsPerMinute;
    const responseHeaders: Record<string, string> = {};
    const request = {
      method: 'GET',
      path: '/health',
      ip: '198.51.100.20',
      headers: {},
    };
    const context = requestContext(request, responseHeaders);

    for (let index = 0; index < limit; index += 1) {
      expect(guard.canActivate(context)).toBe(true);
    }
    expect(() => guard.canActivate(context)).toThrowError(/Request rate exceeded/);
    expect(Number(responseHeaders['Retry-After'])).toBeGreaterThanOrEqual(1);
    expect(responseHeaders['X-RateLimit-Policy']).toBe('PUBLIC');
    expect(responseHeaders['X-RateLimit-Remaining']).toBe('0');
  });
});
