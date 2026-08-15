# Reliability — bounded database connection waits

Status: **in progress**
Base: `main` at `e96b44cfeec9a30e4dbf960ff84fe6e33a7168b5`

## Objective

Bound Cloud API and Event Edge PostgreSQL connection establishment so a database/network outage fails quickly and predictably instead of inheriting long operating-system socket timeouts.

## Scope

1. Add validated database connection-timeout configuration to the existing Cloud and Edge pool construction.
2. Use conservative defaults suitable for event operations while allowing bounded deployment overrides.
3. Fail startup/config construction on malformed or out-of-range timeout values.
4. Document the non-secret timeout environment variables.
5. Add unit coverage for defaults, overrides and invalid values.

## Acceptance criteria

- Cloud PostgreSQL connections use `DATABASE_CONNECTION_TIMEOUT_MS`, default 5000 ms, allowed range 1000–30000 ms.
- Event Edge PostgreSQL connections use `EDGE_DATABASE_CONNECTION_TIMEOUT_MS`, default 3000 ms, allowed range 500–15000 ms.
- Invalid, negative, fractional or out-of-range values fail closed.
- Existing database URLs and transaction semantics are unchanged.
- Permanent TypeScript, Android, SCA, formatting and architecture gates remain green.

## Non-goals

- Do not impose a blanket SQL statement timeout in this slice.
- Do not change pool-size tuning.
- Do not add automatic transaction retries.
