# Hostinger managed pilot path

This directory documents the simplified Hostinger managed deployment path for early Event Commerce OS cloud testing.

It is an alternative to `infra/hostinger/pilot`, which remains the hardened Docker/VPS path. The managed path intentionally trades infrastructure control for lower setup overhead. It does not change the offline-first architecture: Android POS remains local-first and Event Edge remains venue-local.

## Topology

Use two separately deployed cloud surfaces from the same GitHub repository:

```text
event.nairobuy.com      -> Event Control Web (static Next.js export)
api-event.nairobuy.com  -> Cloud API (NestJS) -> dedicated Supabase PostgreSQL

Venue LAN
Android POS -> Event Edge -> Cloud API when WAN is available
```

The hyphenated API hostname is the canonical managed-pilot origin because that is the Hostinger deployment that has been verified live with HTTPS, PostgreSQL health, and CORS. Do not introduce `api.event.nairobuy.com` without an explicit DNS/TLS migration plan.

Use external PostgreSQL. Do not convert the application to Hostinger MySQL; the Event Commerce OS persistence and migration stack is PostgreSQL-native.

## Event Control Web on Hostinger

Event Control does not require server-side rendering. Operational data is fetched from the separate Cloud API, so the managed Hostinger build exports the Next.js UI as static files and avoids a persistent Node.js runtime.

Hostinger's managed Next.js runtime was observed generating a `nodejs/server.js` wrapper that attempted `require('next')` after deployment while omitting the required runtime dependency tree. The static export deliberately removes that failure mode.

Confirmed hPanel settings:

```text
Branch: main
Root directory: apps/control-web
Framework preset: React
Node.js: 22.x
Package manager: pnpm
Build command: pnpm run build
Output directory: out
```

The `React` framework preset is intentional even though the source application uses Next.js. In Hostinger this selects the static frontend hosting path. Do **not** switch this deployment back to the `Next.js` framework preset: with `Next.js` plus `.next`, Hostinger was confirmed to create `hbuilds/.../nodejs/server.js` and the deployment returned HTTP 503 with `Cannot find module 'next'`.

With the configuration above, Hostinger copies the static export into `public_html`: `index.html`, `_next`, `.htaccess`, `404.html`, and the exported route directories are served directly. The active hbuild has no `nodejs` directory or generated `server.js`.

Environment variables:

```text
NODE_ENV=production
NEXT_PUBLIC_CLOUD_API_URL=https://api-event.nairobuy.com
```

`NEXT_PUBLIC_CLOUD_API_URL` is compiled into the static export. Redeploy Event Control whenever it changes.

`HOSTINGER_APP_TARGET` is not required for the managed Event Control build. When no explicit target is available during the build, `apps/control-web/next.config.ts` selects `output: 'export'`. Explicit non-managed targets such as Docker use the existing standalone Next.js server build.

The static export carries a `.htaccess` file with the baseline Control Web security headers. Hostinger supports `.htaccess` rules on web and cloud hosting.

The expected managed output is:

```text
apps/control-web/out/
```

There is intentionally no Next.js server process for `event.nairobuy.com` in this mode.

## Cloud API on Hostinger

The Cloud API is a separate persistent Node.js Web App. The live Hostinger deployment proved that the reliable monorepo configuration is repo-root build plus an explicit NestJS entry file rather than Hostinger's framework-specific NestJS preset.

Confirmed hPanel settings:

```text
Branch: main
Root directory: ./
Framework preset: Other
Node.js: 22.x
Package manager: pnpm
Build command: pnpm run build
Output directory: <empty>
Entry file: apps/cloud-api/dist/main.js
```

Hostinger's custom build-command field only supports the package-manager build script rather than arbitrary shell chaining. The API therefore cannot depend on a Hostinger pre-start migration hook.

The live API environment includes:

```text
HOSTINGER_APP_TARGET=cloud-api
NODE_ENV=production
PORT=3000
CONTROL_WEB_ORIGIN=https://event.nairobuy.com
DATABASE_CONNECTION_TIMEOUT_MS=5000
ABUSE_DEPLOYMENT_MODE=single_instance_pilot
ABUSE_UPSTREAM_CONFIRMED=false
TRUST_PROXY_HOPS=1
MPESA_BASE_URL=https://sandbox.safaricom.co.ke
MPESA_CALLBACK_URL=https://api-event.nairobuy.com/payments/providers/mpesa/callback
```

It also requires `DATABASE_URL`, stored only in Hostinger's environment/secret UI. The live pilot uses the dedicated `Event Commerce OS` Supabase project in `eu-central-1` via the direct PostgreSQL endpoint with TLS. Hostinger's Supabase integration does not substitute for `DATABASE_URL`.

The database schema is already provisioned and the application migration ledger contains exact SHA-256 checksums for all repository migrations. A future runtime with a safe migration hook should run `pnpm run db:migrate` before startup, but the current managed Hostinger deployment does not expose such a hook.

The Supabase Data API is intentionally not the application boundary. RLS is enabled without browser-facing policies on Event Commerce tables. The authoritative health check is the NestJS endpoint because it performs a real PostgreSQL query through `DATABASE_URL`:

```text
GET https://api-event.nairobuy.com/health
```

HTTP 200 proves the API process and PostgreSQL round-trip are both healthy.

Keep `MPESA_BASE_URL=https://sandbox.safaricom.co.ke` for the controlled pilot. Do not load live-money credentials merely because the managed deployment is internet-accessible.

## DNS and domains

Canonical managed-pilot HTTPS origins:

```text
event.nairobuy.com
api-event.nairobuy.com
```

Set:

- API `CONTROL_WEB_ORIGIN=https://event.nairobuy.com`;
- API `MPESA_CALLBACK_URL=https://api-event.nairobuy.com/payments/providers/mpesa/callback`;
- Control Web `NEXT_PUBLIC_CLOUD_API_URL=https://api-event.nairobuy.com`.

## Deployment order

1. Deploy Event Control with framework preset `React` and output directory `out`.
2. Provision the dedicated Supabase PostgreSQL database and apply repository migrations.
3. Deploy the Cloud API from repo root with framework preset `Other` and entry `apps/cloud-api/dist/main.js`.
4. Add API environment variables, including `DATABASE_URL`.
5. Verify `https://api-event.nairobuy.com/health` returns HTTP 200.
6. Redeploy Event Control with `NEXT_PUBLIC_CLOUD_API_URL=https://api-event.nairobuy.com`.
7. Verify browser requests from Event Control reach the Cloud API without CORS errors.
8. Create an operator and exercise login, configuration, inventory and dashboard flows.
9. Add M-PESA sandbox credentials only when the provider test matrix is ready.

## Operational notes

If the Supabase database password is ever visible in a screenshot, log, or other copied surface, rotate it immediately and update Hostinger's `DATABASE_URL` in the same maintenance action. A password rotation without the matching Hostinger environment update will intentionally break `/health` until the new connection string is installed.

`PORT=3000` is confirmed working in the current Hostinger deployment. If a future Hostinger runtime changes its port contract and the API starts returning 503 while the build remains healthy, verify Hostinger's runtime port behavior before changing application code.

## Release and safety limitations

This managed path is intended to get the cloud surfaces online quickly for development and controlled pilot validation. It does not prove production load capacity, exact OCI image identity, private container networking, application-container hardening, controlled reverse-proxy configuration, or venue-scale recovery behavior.

Those are not reasons to block early functional testing. They are reasons not to treat a successful managed deployment as production or 20,000-attendee capacity evidence.

Before a large live event, run the production-like load, failure, reconnection, payment-callback, recovery and venue hardware exercises required by the pilot runbook. Move to the Docker/VPS path if managed-hosting resource limits, proxy behavior, observability or operational control become material constraints.
