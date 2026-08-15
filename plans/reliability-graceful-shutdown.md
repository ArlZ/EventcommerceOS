# Reliability — graceful service shutdown

Status: **in progress**
Original base: `main` at `e96b44cfeec9a30e4dbf960ff84fe6e33a7168b5`
Pinned-CI revalidation base: `main` at `bcad290f556b2c250d2f11252ec8abfc126bbf0c`

## Objective

Ensure Cloud API and Event Edge handle normal deployment/process termination through the Nest application lifecycle so existing cleanup hooks, especially database-pool shutdown, run before the process exits.

## Scope

1. Enable Nest shutdown hooks for `SIGTERM` and `SIGINT` in both service bootstraps.
2. Preserve all existing HTTP timeout, abuse-protection and startup configuration.
3. Rely on existing `OnModuleDestroy` database cleanup rather than adding a second process-signal implementation.
4. Validate both applications still build, lint, typecheck and test cleanly.

## Acceptance criteria

- Cloud API registers framework shutdown handling for SIGTERM and SIGINT.
- Event Edge registers framework shutdown handling for SIGTERM and SIGINT.
- Existing database services receive the Nest destroy lifecycle on controlled termination.
- No duplicate custom signal handler is introduced.
- Permanent TypeScript, Android, SCA, formatting and architecture gates remain green.

## Non-goals

- Do not implement a custom deployment orchestrator.
- Do not change transaction semantics or retry policy.
- Do not weaken current request timeout bounds.
