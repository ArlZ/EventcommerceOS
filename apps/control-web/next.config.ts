import { execFileSync } from 'node:child_process';
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

if (managedStaticExport) {
  process.env.RELEASE_COMMIT = resolveManagedReleaseCommit();
}

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

function resolveManagedReleaseCommit(): string {
  const fullGitSha = /^[0-9a-f]{40}$/;
  const repoRoot = resolve(process.cwd(), '../..');

  try {
    const gitSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (fullGitSha.test(gitSha)) return gitSha;
  } catch {
    // Managed hosts may provide source without Git metadata. Fall back to an
    // explicitly supplied exact release identity in that case.
  }

  for (const name of ['RELEASE_COMMIT', 'GITHUB_SHA']) {
    const value = process.env[name]?.trim() ?? '';
    if (!value) continue;
    if (!fullGitSha.test(value)) {
      throw new Error(`${name} must be a lowercase 40-character Git SHA`);
    }
    return value;
  }

  throw new Error(
    'Managed Control Web build requires Git metadata or RELEASE_COMMIT/GITHUB_SHA release identity',
  );
}
