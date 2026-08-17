# Hostinger managed Web App pilot path

This directory documents the simplified Hostinger managed Node.js deployment path for early Event Commerce OS cloud testing.

It is an alternative to `infra/hostinger/pilot`, which remains the hardened Docker/VPS path. The managed path intentionally trades infrastructure control for lower setup overhead. It does not change the offline-first architecture: Android POS remains local-first and Event Edge remains venue-local.

## Topology

Deploy two separate Hostinger Node.js Web Apps from the same GitHub repository:

```text
control.pilot.example.com  -> Event Control Web (Next.js)
api.pilot.example.com      -> Cloud API (NestJS) -> external PostgreSQL

Venue LAN
Android POS -> Event Edge -> Cloud API when WAN is available
```

Use an external PostgreSQL provider such as Supabase. Do not convert the application to Hostinger MySQL; the Event Commerce OS persistence and migration stack is PostgreSQL-native.

## Repository/runtime contract

The repository root is the deployment root for both managed apps so pnpm can resolve workspace packages.

Required runtime:

- Node.js 22.x;
- pnpm 11.22.0;
- repository root as the application root;
- `pnpm install` performed by Hostinger before the selected build command.

pnpm configuration lives in `pnpm-workspace.yaml`. Do not move overrides back into the `pnpm` field of `package.json` because pnpm 11 no longer reads project settings from there.

## App 1: Cloud API

Create a Hostinger Node.js Web App from `ArlZ/EventcommerceOS`.

Recommended settings:

```text
Branch: main after the managed-hosting change is merged
Node.js: 22.x
Framework: Other if Hostinger does not correctly detect the monorepo target
Root directory: repository root
Build command: pnpm hostinger:cloud-api:build
Start command: pnpm hostinger:cloud-api:start
Port: 3000
```

`hostinger:cloud-api:start` runs the audited database migration runner before starting NestJS. A migration failure therefore prevents the new API process from starting.

Import the variables from `cloud-api.env.example`, replacing all placeholders in hPanel. At minimum the production API requires:

- `DATABASE_URL`;
- `CONTROL_WEB_ORIGIN`;
- `ABUSE_DEPLOYMENT_MODE=single_instance_pilot`;
- `TRUST_PROXY_HOPS` validated against Hostinger's actual proxy behavior;
- Safaricom sandbox values when M-PESA testing begins.

Keep `MPESA_BASE_URL=https://sandbox.safaricom.co.ke` for the controlled pilot. Do not load live-money credentials merely because the managed deployment is reachable from the internet.

### PostgreSQL

Use an external PostgreSQL database. Supabase is the preferred low-ops starting point because Hostinger supports connecting Node.js apps to Supabase, but the application itself only needs a valid PostgreSQL `DATABASE_URL`.

Use a TLS-required connection string suitable for a persistent Node.js service. Do not commit it to GitHub. Keep database credentials only in Hostinger environment variables and the database provider's secret store.

## App 2: Event Control Web

Create a second Hostinger Node.js Web App from the same repository.

Recommended settings:

```text
Branch: main after the managed-hosting change is merged
Node.js: 22.x
Framework: Other if Hostinger does not correctly detect the monorepo target
Root directory: repository root
Build command: pnpm hostinger:control-web:build
Start command: pnpm hostinger:control-web:start
Port: 3000
```

Import the variables from `control-web.env.example`.

`NEXT_PUBLIC_CLOUD_API_URL` must be the canonical HTTPS origin of the Cloud API and must be present before the Next.js build because it is compiled into the client bundle.

## DNS and domains

Use separate HTTPS hostnames, for example:

```text
api.pilot.example.com
control.pilot.example.com
```

Attach the API hostname to the Cloud API app and the control hostname to the Event Control Web app. Then update:

- API `CONTROL_WEB_ORIGIN` to the final Event Control HTTPS origin;
- API `MPESA_CALLBACK_URL` to the final API HTTPS callback URL;
- Control Web `NEXT_PUBLIC_CLOUD_API_URL` to the final API HTTPS origin.

Redeploy after any environment-variable change that affects a build-time value.

## Deployment order

1. Provision the external PostgreSQL database.
2. Create the Cloud API managed Web App.
3. Add API environment variables, including `DATABASE_URL`.
4. Deploy and verify `https://<api-domain>/health` returns healthy.
5. Create the Event Control Web managed Web App.
6. Set `NEXT_PUBLIC_CLOUD_API_URL` to the live API origin.
7. Deploy and verify `https://<control-domain>/api/health`.
8. Verify browser requests from Event Control reach the Cloud API without CORS errors.
9. Create an operator and exercise login, configuration, inventory and dashboard flows.
10. Add M-PESA sandbox credentials only when the provider test matrix is ready.

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
