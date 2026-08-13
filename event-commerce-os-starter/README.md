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

## Repository shape to build

```text
/apps
  /cloud-api          NestJS / TypeScript
  /control-web        Next.js / TypeScript
  /event-edge         NestJS / TypeScript
  /pos-android        Kotlin / Jetpack Compose
/packages
  /domain             Core domain rules and types
  /contracts          API/event schemas
  /observability      Logging, tracing, metrics conventions
  /testkit            Shared fixtures and simulation utilities
/infra
/docs
/plans
/prompts
AGENTS.md
```

## Read first

Codex and human contributors should read, in order:

1. `AGENTS.md`
2. `docs/PRODUCT.md`
3. `docs/ARCHITECTURE.md`
4. `docs/DOMAIN_MODEL.md`
5. the relevant domain document for the task
6. the active file in `plans/`

## First build task

Open `prompts/CODEX_TASK_001.md` and give it to Codex from the repository root.

Do not start payment-provider integrations until Tasks 001–004 have established the domain model, local transaction durability, sync contract and inventory ledger.
