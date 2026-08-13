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

### Architecture decisions changed

None. The implementation follows the previously locked modular-monolith, local-first and framework-independent-domain decisions.

### Commands/tests run

No build/test command is claimed as executed successfully from the GitHub connector environment because that environment cannot install package registries or run the Android/Node toolchains. GitHub Actions on the pull request is the executable validation gate for:

- TypeScript build, lint, typecheck, tests, formatting and architecture checks.
- Android `testDebugUnitTest` and `lintDebug`.

### Known debt

- `pnpm-lock.yaml` is not yet committed because dependency resolution could not be executed in the connector environment. Generate and commit it after a successful dependency install.
- Production database migrations, auth, telemetry exporters and domain features are deliberately absent from Task 001.
- Real-device Android performance and persistence behaviour remains a later hardware validation requirement.

### Recommended Plan 002

Implement the smallest vertical slice toward `create event -> create sales location -> create product -> open POS -> create locally durable order`: begin with event, generic sales-location and product/catalogue configuration only, keeping domain rules framework-independent and without payment-provider integration.
