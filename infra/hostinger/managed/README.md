# Hostinger managed Web App pilot path

This directory documents the simplified Hostinger managed Node.js deployment path for early Event Commerce OS cloud testing.

It is an alternative to `infra/hostinger/pilot`, which remains the hardened Docker/VPS path. The managed path intentionally trades infrastructure control for lower setup overhead. It does not change the offline-first architecture: Android POS remains local-first and Event Edge remains venue-local.

## Topology

Deploy two separate Hostinger Node.js Web Apps from the same GitHub repository:

```text
event.nairobuy.com      -> Event Control Web (Next.js)
api.event.nairobuy.com  -> Cloud API (NestJS) -> external PostgreSQL

Venue LAN
Android POS -> Event Edge -> Cloud API when WAN is available
```

Use an external PostgreSQL provider such as Supabase. Do not convert the application to Hostinger MySQL; the Event Commerce OS persistence and migration stack is PostgreSQL-native.

## Repository/runtime contract

The repository root remains the deployment root so pnpm can resolve all workspace packages.

Required runtime:

- Node.js 22.x;
- pnpm 11.22.0;
- repository root as the application root;
- `pnpm install` performed by Hostinger;
- the root `package.json` exposes `server.js` as the entry point;
- the root build script builds the workspace through Corepack so it does not depend on Hostinger preserving pnpm on the child-shell PATH.

Hostinger may not expose free-form Build command and Start command fields. The managed deployment therefore supports Hostinger's auto-detected flow. When Hostinger classifies the monorepo as `Other`, use `server.js` as the Entry file if the field is shown.

pnpm configuration lives in `pnpm-workspace.yaml`. Do not move overrides back into the `pnpm` field of `package.json` because pnpm 11 no longer reads project settings from there.

## App 1: Event Control Web

Create a Hostinger Node.js Web App from `ArlZ/EventcommerceOS`.

Recommended settings where Hostinger exposes them:

```text
Branch: main
Node.js: 22.x
Package manager: pnpm
Framework: Other if Hostinger does not correctly detect the monorepo target
Root directory: repository root
Entry file: server.js (if requested)
Port: 3000
```

Environment variables:

```text
HOSTINGER_APP_TARGET=control-web
NODE_ENV=production
PORT=3000
NEXT_PUBLIC_CLOUD_API_URL=https://api.event.nairobuy.com
```

`HOSTINGER_APP_TARGET` is optional for Event Control because `control-web` is the safe default, but set it explicitly in hPanel to make the deployment intent obvious.

## App 2: Cloud API

Create a second Hostinger Node.js Web App from the same repository.

Use the same Node.js, package-manager, root-directory and entry-file settings, but set:

```text
HOSTINGER_APP_TARGET=cloud-api
```

The root `server.js` adapter runs the audited Cloud API migration runner before starting the built NestJS service. A migration failure prevents the API process from starting.

Import the remaining variables from `cloud-api.env.example`, replacing all placeholders in hPanel. At minimum the API requires:

- `DATABASE_URL`;
- `CONTROL_WEB_ORIGIN=https://event.nairobuy.com`;
- `ABUSE_DEPLOYMENT_MODE=single_instance_pilot`;
- `TRUST_PROXY_HOPS` validated against Hostinger's actual proxy behavior;
- Safaricom sandbox values when M-PESA testing begins.

Keep `MPESA_BASE_URL=https://sandbox.safaricom.co.ke` for the controlled pilot. Do not load live-money credentials merely because the managed deployment is reachable from the internet.

### PostgreSQL

Use an external PostgreSQL database. Supabase is the preferred low-ops starting point because Hostinger supports connecting Node.js apps to Supabase, but the application itself only needs a valid PostgreSQL `DATABASE_URL`.

Use a TLS-required connection string suitable for a persistent Node.js service. Do not commit it to GitHub. Keep database credentials only in Hostinger environment variables and the database provider's secret store.

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

Redeploy after any environment-variable change that affects a build-time value.

## Deployment order

1. Deploy Event Control first and confirm the root page loads through `server.js`.
2. Provision the external PostgreSQL database.
3. Create the Cloud API managed Web App from the same repository.
4. Add API environment variables, including `HOSTINGER_APP_TARGET=cloud-api` and `DATABASE_URL`.
5. Deploy and verify `https://api.event.nairobuy.com/health` returns healthy.
6. Redeploy Event Control with `NEXT_PUBLIC_CLOUD_API_URL=https://api.event.nairobuy.com`.
7. Verify browser requests from Event Control reach the Cloud API without CORS errors.
8. Create an operator and exercise login, configuration, inventory and dashboard flows.
9. Add M-PESA sandbox credentials only when the provider test matrix is ready.

## Release and safety limitations

This managed path is intended to get the cloud surfaces online quickly for development and controlled pilot validation. Compared with the Docker/VPS path it does not currently prove:

- exact OCI image/revision identity;
- private container networking;
- application container hardening controls;
- database-level backup/restore scripts running on the same host;
- controlled reverse-proxy configuration;
- production load capacity.

Those are not reasons to block early functional testing. They are reasons not to treat a successful managed deployment as production or 20,000-attendee capacity evidence.

Before a large live event, run the production-like load, failure, reconnection, payment-callback, recovery and venue hardware exercises required by the pilot runbook. Move to the Docker/VPS path if managed-hosting resource limits, proxy behavior, observability or operational control become material constraints.
