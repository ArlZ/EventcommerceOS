# Event Commerce OS

An event-native, offline-first commerce and bar operations platform for festivals, concerts, temporary venues, activations and multi-bar events.

## Product thesis

The product is not a restaurant POS adapted for events. It is temporary-commerce infrastructure designed for unreliable networks, high transaction velocity, short-term staff, distributed stock and multiple payment rails.

The first wedge is event bar operations. The underlying domain model remains generic enough to support food, merchandise, VIP hospitality and other sales locations later.

## Primary surfaces

1. **POS** — bartender/cashier application, Android, local-first.
2. **Event Control** — live operational command centre for event managers, inventory teams, finance and supervisors.
3. **HQ** — multi-event administration, templates, reporting and organisation management.
4. **Event Edge** — local event server that allows event operations to continue even when cloud connectivity is degraded or unavailable.

## Non-negotiable principles

- Selling must not depend on cloud availability.
- A sale acknowledged by a POS must be durable locally before the UI confirms success.
- Money is represented as integer minor units; never floating point.
- Inventory is ledger-based and append-only; current stock is derived from movements.
- Financial, inventory and audit records are never hard-deleted.
- Payments are idempotent and have explicit state machines.
- Raw card credentials are never stored or processed by our application.
- M-PESA and other PSPs are integrated through adapters, never hardwired into the domain.
- Every sensitive operational action is attributable to actor, device, time and reason.
- Inventory alerts are operational workflows, not passive dashboard widgets.
- The bartender path is optimised for speed and simplicity over administrative flexibility.

## Repository structure

```text
/apps
  /cloud-api          NestJS / TypeScript
  /control-web        Next.js / TypeScript
  /event-edge         NestJS / TypeScript
  /pos-android        Kotlin / Jetpack Compose / Room
/packages
  /domain             Framework-independent domain foundation
  /contracts          Shared API/event contracts
  /observability      Logging/tracing interfaces and conventions
  /testkit            Shared deterministic test utilities
/infra                 Local PostgreSQL services
/scripts               Architecture dependency checks
/docs
/plans
/prompts
```

## Development prerequisites

- Node.js 22.x
- pnpm 11.22.0
- Docker with Compose support
- For Android: JDK 17, Android SDK 35 and Gradle 8.11.1 (or Android Studio with an equivalent supported toolchain)

No production secrets belong in this repository. Values in `infra/docker-compose.yml` are local-development-only credentials.

## Install

```bash
pnpm install --frozen-lockfile
```

`pnpm-lock.yaml` is committed and CI uses frozen-lockfile installation so dependency resolution is reproducible.

## Hostinger deployment paths

Two Hostinger cloud deployment paths are retained:

- `infra/hostinger/managed` — simplified managed Node.js Web Apps for early controlled cloud testing;
- `infra/hostinger/pilot` — hardened Docker/VPS path for the controlled pilot when deeper infrastructure control is required.

Both preserve the venue-local Event Edge and local-first Android POS boundary.

## Start the local TypeScript stack

One command starts the two local PostgreSQL services, builds shared packages, then runs Cloud API, Event Edge and Control Web:

```bash
make dev
```

Health endpoints:

- Control Web: `http://localhost:3000/api/health`
- Cloud API: `http://localhost:3001/health`
- Event Edge: `http://localhost:3002/health`

Stop infrastructure with:

```bash
make infra-down
```

## Quality checks

```bash
make check
```

This runs TypeScript builds, linting, typechecking, tests, formatting checks and architecture dependency guardrails.

Android checks are intentionally separate from the JavaScript workspace:

```bash
make android-check
```

GitHub Actions runs the TypeScript/architecture, Android and fail-closed dependency-SCA gates on pull requests. A permanent synthetic backup/restore smoke also exercises the recovery mechanism and retains non-sensitive evidence artifacts.

## Architecture guardrails

`pnpm arch:check` mechanically rejects shared packages importing application code, framework dependencies entering `packages/domain`, and direct cross-application TypeScript imports. These checks supplement the architecture invariants in `AGENTS.md`; they do not replace code review.

## Validation status

Tasks 001–010 and the subsequent security/reliability remediation stack are integrated on `main`. The validated surface now includes Cloud and Event Edge migrations, TypeScript builds, linting, typechecking, unit/integration tests, formatting, architecture dependency guardrails, Android unit tests/lint, fail-closed dependency SCA, deterministic event-fault simulation and a synthetic PostgreSQL backup/isolated-restore regression smoke.

The current dependency scan is materially reduced from the earlier baseline and retains one visible non-blocking MODERATE Kotlin build-tooling advisory; it is tracked in issue #32 rather than suppressed or hidden.

This repository is **not yet cleared for an internet-exposed production or live-money pilot**. Remaining release gates require real-world evidence that cannot be substituted by CI: protected-branch enforcement, a representative backup/restore drill with named sign-off, the actual deployment abuse/flood exercise, supported-device/network/Edge-hardware testing, provider fault/reconciliation testing and a controlled pilot close. See `plans/010-production-hardening.md`, `docs/RELEASE_SECURITY_REVIEW.md` and `docs/PILOT_RUNBOOK.md`.

`make dev` remains a developer runtime command rather than a CI integration test; local PostgreSQL startup and real-device Android behaviour should still be validated in the appropriate development and pilot environments.

## Read first

Contributors should read `AGENTS.md`, the relevant documents under `docs/`, and the active execution plan under `plans/` before implementation work.

Do not start payment-provider integrations until Tasks 001–004 have established the domain model, local transaction durability, sync contract and inventory ledger.
