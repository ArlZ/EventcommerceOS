# Reliability — migration integrity and database target safety

Status: **in progress**
Base: `main` at `ee93a22a796996fe890293d30766bda6e3da5367`

## Objective

Prevent previously applied SQL migrations from silently changing after deployment, and ensure production migration runners never guess which database to modify.

## Scope

1. Bind Cloud API and Event Edge migration ledger rows to SHA-256 of the exact SQL bytes.
2. For legacy migration rows that predate checksums, baseline the current repository bytes once under the existing advisory lock; document that this provides future drift detection, not retroactive proof.
3. Refuse a migration run when a stored checksum differs from the current migration file.
4. Require explicit `DATABASE_URL` for Cloud production migrations.
5. Require explicit `EDGE_DATABASE_URL` for Event Edge production migrations; never fall back to generic `DATABASE_URL` in production.
6. Preserve local-development fallbacks outside production.
7. Add permanent tests for production fail-closed targeting, checksum determinism, legacy baselining, exact match and drift rejection.

## Acceptance criteria

- New Cloud and Edge migration rows store lowercase SHA-256 checksums.
- Existing rows with no checksum receive a one-time baseline under migration lock.
- Existing rows with a matching checksum are skipped normally.
- Existing rows with a different checksum fail before any later migration is applied.
- Production Cloud migration requires explicit `DATABASE_URL`.
- Production Event Edge migration requires explicit `EDGE_DATABASE_URL`, even if generic `DATABASE_URL` is present.
- Non-production developer/test fallbacks remain available.
- Existing migration ordering, transaction semantics and advisory locking remain intact.
- Full repository CI, SCA, secret scan and runtime-container migration smoke remain green.

## Non-goals

- Do not claim historical migration bytes are proven for rows created before checksum support.
- Do not rewrite already-applied migrations.
- Do not add automatic rollback/down migrations.
- Do not change the separate operator/credential administration tools in this slice.
- Do not change business schemas outside the migration ledger metadata needed for integrity.
