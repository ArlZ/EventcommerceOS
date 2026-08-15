# Reliability — bounded database connection waits

Status: **in progress**
Original base: `main` at `e96b44cfeec9a30e4dbf960ff84fe6e33a7168b5`
Pinned-CI revalidation base: `main` at `bcad290f556b2c250d2f11252ec8abfc126bbf0c`

## Objective

Bound Cloud API and Event Edge PostgreSQL connection establishment so a database/network outage fails quickly and predictably instead of inheriting long operating-system socket timeouts, and fail closed when production database endpoints are not explicitly configured.

## Scope

1. Add validated database connection-timeout configuration to the existing Cloud and Edge pool construction.
2. Use conservative defaults suitable for event operations while allowing bounded deployment overrides.
3. Fail startup/config construction on malformed or out-of-range timeout values.
4. Require explicit `DATABASE_URL` for Cloud production runtime and explicit `EDGE_DATABASE_URL` for Edge production runtime.
5. Correct the environment example from unused `CLOUD_DATABASE_URL` to the actual Cloud `DATABASE_URL` variable.
6. Document the non-secret timeout environment variables.
7. Add unit coverage for defaults, overrides, missing production URLs and invalid values.

## Acceptance criteria

- Cloud PostgreSQL connections use `DATABASE_CONNECTION_TIMEOUT_MS`, default 5000 ms, allowed range 1000–30000 ms.
- Event Edge PostgreSQL connections use `EDGE_DATABASE_CONNECTION_TIMEOUT_MS`, default 3000 ms, allowed range 500–15000 ms.
- Invalid, negative, fractional or out-of-range timeout values fail closed.
- Cloud production runtime refuses to construct database configuration without `DATABASE_URL`.
- Edge production runtime refuses to reuse a generic/Cloud `DATABASE_URL` and requires `EDGE_DATABASE_URL`.
- Non-production local fallbacks remain available for tests/development.
- `infra/.env.example` uses `DATABASE_URL` for Cloud and `EDGE_DATABASE_URL` for Event Edge.
- Existing transaction semantics are unchanged.
- Permanent TypeScript, Android, SCA, formatting and architecture gates remain green.

## Non-goals

- Do not impose a blanket SQL statement timeout in this slice.
- Do not change pool-size tuning.
- Do not add automatic transaction retries.
