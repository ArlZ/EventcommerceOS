import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import nextConfig, {
  controlWebSecurityHeaders,
  managedStaticExport,
} from '../next.config';

function headerValue(key: string): string | undefined {
  return controlWebSecurityHeaders.find((header) => header.key === key)?.value;
}

const htaccess = readFileSync(resolve(import.meta.dirname, '../public/.htaccess'), 'utf8');

describe('Control Web response security configuration', () => {
  it('uses static export for the managed Hostinger build shape', () => {
    expect(managedStaticExport).toBe(true);
    expect(nextConfig.output).toBe('export');
    expect(nextConfig.trailingSlash).toBe(true);
    expect(nextConfig.images).toEqual({ unoptimized: true });
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it('preserves baseline response headers in Hostinger .htaccess', () => {
    for (const header of controlWebSecurityHeaders) {
      expect(htaccess).toContain(`Header always set ${header.key}`);
      expect(htaccess).toContain(header.value);
    }
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
