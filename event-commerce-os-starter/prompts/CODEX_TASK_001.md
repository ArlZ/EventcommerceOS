# Codex Task 001 — Establish the Production Repository Foundation

You are the founding senior engineer on Event Commerce OS.

Before changing any file, read:

1. `AGENTS.md`
2. `README.md`
3. `docs/PRODUCT.md`
4. `docs/ARCHITECTURE.md`
5. `docs/DOMAIN_MODEL.md`
6. `docs/OFFLINE_SYNC.md`
7. `docs/SECURITY_RELIABILITY.md`
8. `plans/001-foundation.md`

## Objective

Implement **Execution Plan 001 only**. Build the repository foundation for a production-grade event commerce system. Do not implement payments, inventory or real sales features yet.

## Required repository structure

Create/complete:

```text
/apps
  /cloud-api
  /control-web
  /event-edge
  /pos-android
/packages
  /domain
  /contracts
  /observability
  /testkit
/infra
/docs
/plans
```

Use a pnpm workspace for TypeScript projects. Keep the Android Gradle project in the same repository without forcing it into the JavaScript build system.

## Cloud API and Event Edge

Use NestJS + TypeScript. Establish a strict module/layer pattern that future domains can follow. Create only a small example/system module and health endpoint; avoid fake business implementations.

## Control Web

Use Next.js + TypeScript. Create a minimal shell and health/dev status view. Do not spend time on branding/design yet.

## POS Android

Use Kotlin + Jetpack Compose. Create an application shell with a local app database abstraction prepared for SQLite/Room and a basic local health/status screen. Do not create the final POS UI yet.

## Local infrastructure

Provide a reproducible local environment for PostgreSQL and any strictly necessary dependencies. Do not add Kafka or a distributed message broker. Redis may be omitted until a real need exists.

## Architecture enforcement

Create mechanical checks that make the intended dependency direction visible and fail CI when violated where practical. Keep domain logic framework-independent.

## Testing and CI

Add:
- unit/smoke tests for each runnable app;
- TypeScript lint/format/typecheck;
- Android lint/test task;
- CI workflow that runs relevant checks;
- a root-level developer command or Makefile/scripts that make the common flows easy.

## Documentation

Update `README.md` with exact setup/run/test commands that you have actually validated in the environment.

Update `plans/001-foundation.md` with a completion record when done.

## Constraints

- Follow every invariant in `AGENTS.md`.
- Do not add payment provider SDKs.
- Do not create microservices beyond the explicitly requested cloud API and event edge applications.
- Prefer stable, conventional dependencies.
- Do not invent secrets.
- Do not claim a command passed unless you ran it.
- If a toolchain cannot run in the current environment, state exactly what could not be verified and why.

## Final response

Return:
1. what you built;
2. files/areas changed;
3. commands and tests run with results;
4. architecture guardrails added;
5. anything not verified;
6. recommended next task, which should be the smallest vertical slice toward `create event -> create sales location -> create product -> open POS -> create locally durable order` without yet adding real payment-provider integration.
