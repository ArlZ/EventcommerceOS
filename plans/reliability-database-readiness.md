# Reliability — database-backed service readiness

Status: **in progress**
Base: `main` at `ea868dd00a884bf1f930847ee7b025a7e747ca9e`

## Objective

Make Cloud API and Event Edge `/health` endpoints prove that the service can reach its authoritative local database before reporting `ok`, so deployment preflight cannot approve a process that is alive but unable to transact.

## Scope

1. Inject each service's existing database service into its health controller.
2. Execute a minimal `SELECT 1` readiness probe before returning the normal health contract.
3. Return HTTP 503 on database probe failure without returning database connection details or raw errors.
4. Preserve exact `RELEASE_COMMIT` identity in healthy responses.
5. Add tests for healthy and unavailable database states in both Cloud API and Event Edge.
6. Keep preflight behavior unchanged: a non-2xx health response already blocks deployment readiness.

## Acceptance criteria

- Healthy Cloud API `/health` returns 200 only after a successful Cloud database probe.
- Healthy Event Edge `/health` returns 200 only after a successful Edge database probe.
- Database failure returns 503 rather than a false `ok` or a raw infrastructure error.
- Failure responses do not include database URLs, credentials or driver error details.
- Healthy responses retain service identity and exact release identity.
- Existing TypeScript, Android, SCA, formatting and architecture gates remain green.

## Non-goals

- Do not turn liveness into a deep dependency graph check.
- Do not probe external payment providers from `/health`.
- Do not expose database latency or connection strings in public health responses.
