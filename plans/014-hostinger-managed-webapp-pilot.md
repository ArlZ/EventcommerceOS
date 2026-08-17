# Plan 014 — Hostinger managed Web App pilot

## Goal

Make the Event Commerce OS cloud surfaces deployable on Hostinger managed Node.js Web Apps for early controlled testing, while preserving the existing Docker/VPS deployment path and all offline-first business semantics.

## Why this exists

The first managed Hostinger deployment attempted dependency installation with pnpm 11.22.0 while the repository pinned pnpm 10.12.1. pnpm 11 also no longer reads project settings from the `pnpm` field in `package.json`, so the existing override location generated a compatibility warning.

The managed path is useful for the current stage because it removes VPS provisioning and server administration from the critical path. It is not a replacement for the hardened VPS path when exact image identity, container hardening, private networking, host-level recovery controls or proven large-event capacity become release requirements.

## Scope

1. Align the repository package-manager contract with Hostinger's observed pnpm 11.22.0 runtime.
2. Move pnpm overrides to `pnpm-workspace.yaml`, the pnpm 11 project-configuration location.
3. Keep Node.js on the existing Node 22 major line.
4. Add explicit repository-root build/start scripts for Hostinger Cloud API and Event Control Web deployments.
5. Run Cloud API migrations before managed runtime startup.
6. Document two managed Web Apps from the same monorepo and an external PostgreSQL database.
7. Keep M-PESA sandbox-only for controlled-pilot preparation.
8. Add regression checks for the managed-hosting contract.
9. Preserve the Docker/VPS path and update its pnpm version so both deployment paths remain aligned.

## Managed topology

```text
Hostinger managed Node.js
  Cloud API (NestJS) ------> external PostgreSQL
  Event Control (Next.js) -> Cloud API

Venue
  Android POS -> Event Edge -> Cloud API when WAN is available
```

Event Edge remains venue-local and is not deployed to Hostinger managed hosting.

## Safety constraints

- Do not change order, payment, inventory, sync, reconciliation or POS business semantics.
- Do not convert PostgreSQL persistence to MySQL merely to use Hostinger's native managed database.
- Do not commit database or payment credentials.
- Keep Safaricom sandbox as the only configured M-PESA base URL for this path.
- Keep `single_instance_pilot` abuse semantics until upstream distributed protection is deliberately validated.
- A successful managed deployment is functional evidence only; it is not proof of production readiness or 20,000-attendee capacity.
- Preserve the Docker/VPS path as the escalation route if managed-hosting constraints become material.

## Validation

Repository validation should prove:

- pnpm version contract is 11.22.0;
- Node remains on major version 22;
- no project pnpm settings remain under `package.json#pnpm`;
- security overrides are present in `pnpm-workspace.yaml`;
- managed Cloud API and Event Control build/start scripts exist;
- Cloud API managed startup runs migrations before application startup;
- managed examples keep M-PESA sandbox-only and contain placeholders rather than secrets;
- Docker uses the same pnpm version as managed hosting;
- existing TypeScript, architecture, SCA and container checks remain green.

## Completion boundary

Repository work is complete when the compatibility change is merged with CI green and the managed-hosting instructions are present on `main`.

External evidence remains separate: Hostinger app creation, domains/TLS, external PostgreSQL provisioning, real environment variables, runtime health, browser CORS, operator flows, payment sandbox exercises and production-like load/failure testing.
