import { describe, expect, it } from 'vitest';
import nextConfig, { controlWebSecurityHeaders } from '../next.config';

function headerValue(key: string): string | undefined {
  return controlWebSecurityHeaders.find((header) => header.key === key)?.value;
}

describe('Control Web response security configuration', () => {
  it('disables framework disclosure and applies the baseline headers to every route', async () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    expect(nextConfig.headers).toBeTypeOf('function');

    const rules = await nextConfig.headers?.();
    expect(rules).toEqual([
      {
        source: '/:path*',
        headers: [...controlWebSecurityHeaders],
      },
    ]);
  });

  it('sets non-execution-breaking browser security controls', () => {
    expect(headerValue('X-Frame-Options')).toBe('DENY');
    expect(headerValue('X-Content-Type-Options')).toBe('nosniff');
    expect(headerValue('Referrer-Policy')).toBe('no-referrer');
    expect(headerValue('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(headerValue('Permissions-Policy')).toBe(
      'camera=(), microphone=(), geolocation=(), usb=()',
    );

    const csp = headerValue('Content-Security-Policy');
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain('script-src');
    expect(csp).not.toContain('style-src');
  });

  it('does not claim transport policy before the public TLS boundary is selected', () => {
    expect(headerValue('Strict-Transport-Security')).toBeUndefined();
  });
});
