# Execution Plan 001 — Repository Foundation

## Goal

Create a legible, testable repository skeleton that enforces the architectural invariants before product features are implemented.

## Scope

- TypeScript workspace for cloud API, event edge and control web.
- Android application skeleton.
- shared contracts/domain/testkit packages.
- local development infrastructure.
- CI checks.
- architecture/layer dependency guardrails.
- health endpoints and smoke tests.

## Decisions already locked

- Cloud API: TypeScript + NestJS.
- Control Web: Next.js + TypeScript.
- Event Edge: TypeScript + NestJS initially.
- POS: Kotlin + Jetpack Compose.
- Cloud/edge DB: PostgreSQL.
- POS DB: SQLite.
- Start as a modular monolith, not microservices.
- Money/inventory/payment invariants in `AGENTS.md` are mandatory.

## Acceptance criteria

1. One command starts local cloud API, edge service, control web and infrastructure dependencies (Android emulator/app may be separate).
2. Each service has a health check.
3. Unit and smoke tests run in CI.
4. Formatting/lint/type checks run in CI for relevant stacks.
5. Shared contracts can be versioned/tested without circular dependencies.
6. A structural test/lint prevents forbidden dependency direction in TypeScript modules.
7. No payment provider SDK is introduced yet.
8. `README.md` contains exact local setup commands after implementation.

## Non-goals

- production auth;
- provider integrations;
- final UI design;
- inventory implementation;
- real order processing.

## Completion record

When completed, append:
- implementation summary;
- changed architecture decisions;
- commands/tests run;
- known debt;
- recommended Plan 002.
