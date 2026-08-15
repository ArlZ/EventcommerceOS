import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  classifyEdgeAbuseRequest,
  EdgeAbuseProtectionGuard,
} from '../src/security/edge-abuse-protection.guard';

function contextFor(
  request: Record<string, unknown>,
  responseHeaders: Record<string, string>,
): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({
        setHeader(name: string, value: string) {
          responseHeaders[name] = value;
        },
      }),
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

describe('Event Edge abuse protection', () => {
  it('classifies POS sync and payment routes into separate high-throughput policies', () => {
    expect(
      classifyEdgeAbuseRequest({
        method: 'POST',
        path: '/sync/device-events',
        headers: { authorization: 'Bearer device-secret', 'x-device-id': 'device-a' },
      }),
    ).toMatchObject({ policy: 'DEVICE_SYNC' });
    expect(
      classifyEdgeAbuseRequest({
        method: 'POST',
        path: '/payments/initiate',
        headers: { authorization: 'Bearer device-secret', 'x-device-id': 'device-a' },
      }),
    ).toMatchObject({ policy: 'DEVICE_PAYMENT' });
    expect(
      classifyEdgeAbuseRequest({
        method: 'POST',
        path: '/inventory/transfers',
        headers: {},
      }),
    ).toEqual({ policy: 'LOCAL_OTHER', principal: undefined });
  });

  it('fingerprints the device credential instead of retaining it as a bucket principal', () => {
    const secret = 'Bearer device-secret-that-must-not-be-retained';
    const classified = classifyEdgeAbuseRequest({
      method: 'POST',
      path: '/sync/device-events',
      headers: { authorization: secret, 'x-device-id': 'device-a' },
    });
    expect(classified?.principal).toMatch(/^[0-9a-f]{64}$/);
    expect(classified?.principal).not.toContain(secret);
  });

  it('returns 429 after a local source exceeds the fallback policy', () => {
    const guard = new EdgeAbuseProtectionGuard();
    const limit = guard.limit('LOCAL_OTHER');
    const headers: Record<string, string> = {};
    const request = {
      method: 'GET',
      path: '/health',
      ip: '192.0.2.50',
      headers: {},
    };
    const context = contextFor(request, headers);

    for (let index = 0; index < limit; index += 1) {
      expect(guard.canActivate(context)).toBe(true);
    }
    expect(() => guard.canActivate(context)).toThrowError(/Event Edge request rate exceeded/);
    expect(headers['X-RateLimit-Policy']).toBe('LOCAL_OTHER');
    expect(headers['X-RateLimit-Remaining']).toBe('0');
    expect(Number(headers['Retry-After'])).toBeGreaterThanOrEqual(1);
  });
});
