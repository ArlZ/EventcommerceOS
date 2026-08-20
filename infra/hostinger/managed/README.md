# Hostinger managed pilot path

This directory documents the simplified Hostinger managed deployment path for early Event Commerce OS cloud testing.

It is an alternative to `infra/hostinger/pilot`, which remains the hardened Docker/VPS path. The managed path intentionally trades infrastructure control for lower setup overhead. It does not change the offline-first architecture: Android POS remains local-first and Event Edge remains venue-local.

## Topology

Use two separately deployed cloud surfaces from the same GitHub repository:

```text
event.nairobuy.com      -> Event Control Web (static Next.js export)
api.event.nairobuy.com  -> Cloud API (NestJS) -> external PostgreSQL

Venue LAN
Android POS -> Event Edge -> Cloud API when WAN is available
```

Use an external PostgreSQL provider such as Supabase. Do not convert the application to Hostinger MySQL; the Event Commerce OS persistence and migration stack is PostgreSQL-native.

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
NEXT_PUBLIC_CLOUD_API_URL=https://api.event.nairobuy.com
```

`HOSTINGER_APP_TARGET` is not required for the managed Event Control build. When no explicit target is available during the build, `apps/control-web/next.config.ts` selects `output: 'export'`. Explicit non-managed targets such as Docker use the existing standalone Next.js server build.

The static export carries a `.htaccess` file with the baseline Control Web security headers. Hostinger supports `.htaccess` rules on web and cloud hosting.

The expected managed output is:

```text
apps/control-web/out/
```

There is intentionally no Next.js server process for `event.nairobuy.com` in this mode.

## Cloud API on Hostinger

Create a separate Hostinger Web App for the API. The Cloud API remains a server-side NestJS service and still requires PostgreSQL.

Set:

```text
HOSTINGER_APP_TARGET=cloud-api
NODE_ENV=production
PORT=3000
CONTROL_WEB_ORIGIN=https://event.nairobuy.com
```

Import the remaining variables from `cloud-api.env.example`, replacing all placeholders in hPanel. At minimum the API requires `DATABASE_URL`, validated proxy settings, and Safaricom sandbox values when M-PESA testing begins.

The Cloud API includes compatibility with Hostinger's Supabase integration, but the transactional application path remains PostgreSQL-native. Keep database credentials in Hostinger/provider secret stores and never commit them.

Keep `MPESA_BASE_URL=https://sandbox.safaricom.co.ke` for the controlled pilot. Do not load live-money credentials merely because the managed deployment is internet-accessible.

## DNS and domains

Use separate HTTPS hostnames:

```text
event.nairobuy.com
api.event.nairobuy.com
```

Then set:

- API `CONTROL_WEB_ORIGIN=https://event.nairobuy.com`;
- API `MPESA_CALLBACK_URL=https://api.event.nairobuy.com/payments/providers/mpesa/callback`;
- Control Web `NEXT_PUBLIC_CLOUD_API_URL=https://api.event.nairobuy.com`.

Redeploy Event Control after changing `NEXT_PUBLIC_CLOUD_API_URL` because it is compiled into the static frontend.

## Deployment order

1. Deploy Event Control with output directory `out` and confirm the root page loads without a Node runtime.
2. Provision the external PostgreSQL database.
3. Create the Cloud API managed Web App.
4. Add API environment variables, including `DATABASE_URL`.
5. Deploy and verify `https://api.event.nairobuy.com/health` returns healthy.
6. Redeploy Event Control with the final public API origin.
7. Verify browser requests from Event Control reach the Cloud API without CORS errors.
8. Create an operator and exercise login, configuration, inventory and dashboard flows.
9. Add M-PESA sandbox credentials only when the provider test matrix is ready.

## Release and safety limitations

This managed path is intended to get the cloud surfaces online quickly for development and controlled pilot validation. It does not prove production load capacity, exact OCI image identity, private container networking, application-container hardening, controlled reverse-proxy configuration, or venue-scale recovery behavior.

Those are not reasons to block early functional testing. They are reasons not to treat a successful managed deployment as production or 20,000-attendee capacity evidence.

Before a large live event, run the production-like load, failure, reconnection, payment-callback, recovery and venue hardware exercises required by the pilot runbook. Move to the Docker/VPS path if managed-hosting resource limits, proxy behavior, observability or operational control become material constraints.
