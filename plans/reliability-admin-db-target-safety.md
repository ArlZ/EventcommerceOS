# Reliability — administrative database target safety

Status: **in progress (stacked behind PR #53)**
Base: migration-integrity candidate `dfce643b5b71681895b879cb4bda0dad7bb79f16`

## Objective

Ensure database-mutating administrative utilities cannot silently operate against a local or generic database target in production.

## Scope

1. Cloud operator-auth administration must use the same explicit production `DATABASE_URL` safety helper as Cloud migrations.
2. Cloud Event Edge credential administration must use the same explicit production `DATABASE_URL` safety helper.
3. Event Edge POS-device administration must use the Edge-specific target helper:
   - explicit `EDGE_DATABASE_URL` in production;
   - never generic `DATABASE_URL` in production;
   - preserve existing non-production developer fallback behavior.
4. Add tests proving the package commands are wired through the fail-closed helpers rather than maintaining separate target-selection logic.
5. Update operator/device operational documentation to state the required production database target variables.

## Acceptance criteria

- Production operator-auth and Edge-credential commands fail before database access when `DATABASE_URL` is absent.
- Production POS-device administration fails before database access when `EDGE_DATABASE_URL` is absent, even if generic `DATABASE_URL` is present.
- Non-production workflows remain usable with current local/developer database conventions.
- No credential/token material is logged or added to source control.
- Permanent CI, secret scan, SCA and relevant runtime packaging gates remain green.

## Non-goals

- Do not change credential/session formats, roles, TTLs or business authorization.
- Do not add a new secrets manager or identity provider.
- Do not modify backup/restore tooling, which already requires explicit database URLs.
