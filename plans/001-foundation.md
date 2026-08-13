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
- POS DB: SQLite/Room.
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

## Completion record — Task 001 implementation

### Implementation summary

- Established the pnpm workspace and strict shared TypeScript compiler baseline.
- Added NestJS Cloud API and Event Edge shells with `/health` endpoints and smoke tests.
- Added a minimal Next.js Event Control shell with `/api/health` and a smoke test.
- Added native Android Kotlin/Jetpack Compose POS shell with a Room/SQLite metadata database foundation and unit test.
- Added framework-independent `domain`, `contracts`, `observability` and `testkit` packages.
- Added two reproducible local PostgreSQL services for cloud and edge development.
- Added mechanical dependency-boundary checks and GitHub Actions jobs for TypeScript and Android.
- Added `make dev`, `make check` and `make android-check` developer entry points.
- Committed `pnpm-lock.yaml` and configured CI to require frozen-lockfile installation.

### Architecture decisions changed

None. The implementation follows the previously locked modular-monolith, local-first and framework-independent-domain decisions.

### Commands/tests run

GitHub Actions on the Task 001 pull request has executed the repository validation gate successfully, including:

- pnpm dependency installation from the committed lockfile;
- TypeScript production builds;
- linting and strict typechecking;
- shared package and application unit/smoke tests;
- formatting checks;
- architecture dependency guardrails;
- Android `testDebugUnitTest` and `lintDebug`.

Any subsequent commit must pass the same CI gate before merge.

### Known debt

- Production database migrations, auth, telemetry exporters and domain features are deliberately absent from Task 001.
- `make dev` and the local PostgreSQL runtime still require developer-environment validation rather than being covered by the current CI integration gate.
- Real-device Android performance and persistence behaviour remains a later hardware validation requirement.

### Recommended Plan 002

Implement the smallest vertical slice toward `create event -> create sales location -> create product -> open POS -> create locally durable order`: begin with event, generic sales-location and product/catalogue configuration only, keeping domain rules framework-independent and without payment-provider integration.
