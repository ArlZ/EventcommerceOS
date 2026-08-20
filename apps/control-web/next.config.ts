import { resolve } from 'node:path';
import type { NextConfig } from 'next';

export const controlWebSecurityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: "base-uri 'self'; frame-ancestors 'none'; object-src 'none'",
  },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), usb=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
] as const;

// Hostinger's managed frontend build currently invokes this workspace without
// exposing HOSTINGER_APP_TARGET during the build. In that mode Event Control
// does not need a persistent Node process: all operational data is fetched from
// the separate Cloud API, so export the UI as static files. Explicit non-
// Hostinger targets (Docker/VPS/Render) retain the standalone Next.js server.
export const managedStaticExport =
  process.env.HOSTINGER_APP_TARGET === undefined ||
  process.env.HOSTINGER_APP_TARGET === 'control-web';

const nextConfig: NextConfig = managedStaticExport
  ? {
      output: 'export',
      trailingSlash: true,
      images: { unoptimized: true },
      poweredByHeader: false,
    }
  : {
      output: 'standalone',
      outputFileTracingRoot: resolve(process.cwd(), '../..'),
      poweredByHeader: false,
      async headers() {
        return [
          {
            source: '/:path*',
            headers: [...controlWebSecurityHeaders],
          },
        ];
      },
    };

export default nextConfig;
