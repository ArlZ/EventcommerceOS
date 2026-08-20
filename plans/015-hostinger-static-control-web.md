# Plan 015 — Hostinger static Event Control Web

## Problem

Hostinger's managed Next.js deployment builds Event Control successfully but its generated runtime wrapper starts from `nodejs/server.js` and calls `require('next')`. The managed runtime does not preserve the dependency layout needed for that generated launcher, so the deployed site returns HTTP 503 with `Cannot find module 'next'` even when the build output is valid.

## Decision

Deploy Event Control on managed Hostinger as a Next.js static export instead of a persistent Next.js server.

This is safe for the managed surface because Event Control already obtains operational data from the separately deployed Cloud API. The only local server route is the health route, which can be exported as a build-time static GET response.

The Docker/VPS/Render deployment path remains server-capable and continues to use Next.js standalone output when an explicit non-managed target is supplied.

## Implementation

- select `output: 'export'` when the Control Web build has no explicit `HOSTINGER_APP_TARGET` or is explicitly `control-web`;
- retain `output: 'standalone'` for explicit non-managed targets;
- make `/api/health` statically exportable;
- publish managed output from `apps/control-web/out`;
- preserve baseline browser security headers through a Hostinger-compatible `.htaccess` file in the static export;
- remove the portable `node_modules` staging step from the Control Web build;
- add CI that builds exactly the Hostinger-observed shape with no target variable and verifies `out/index.html`, static assets, and `.htaccess` exist with no server runtime;
- keep Cloud API, Event Edge, PostgreSQL, M-PESA sandbox and offline-first boundaries unchanged.

## Validation

Before merge:

1. Hostinger-style Control Web static export succeeds with no target variable.
2. Full workspace build, lint, typecheck, tests, format and architecture checks pass.
3. Docker runtime images still build and boot using the explicit container target.
4. Android and SCA/secret gates pass.

After merge:

1. Set Hostinger Event Control output directory to `out`.
2. Redeploy from `main`.
3. Confirm `event.nairobuy.com` loads without a persistent Node.js runtime or `Cannot find module 'next'` error.
4. Verify navigation across all exported routes.
5. Verify browser calls to the separate Cloud API after that API is deployed.

## Safety limitation

A successful static frontend deployment proves only that the managed Event Control surface is reachable. It does not establish live-money readiness or 20,000-attendee capacity.
