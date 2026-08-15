# Reliability — exact-release recovery provenance

Status: **in progress**
Base: `main` at `58dca72842aeb900334d614d4f8caa21e651f6b2`

## Objective

Tighten backup/restore drill evidence so it is unambiguously bound to one exact application release and records the actual external backup/restore process timestamps rather than reconstructed timing.

## Scope

1. Require `RELEASE_COMMIT_SHA` to be a full lowercase 40-character Git SHA.
2. Record actual command start/completion timestamps from the same clock used for duration measurement.
3. Evolve backup/restore evidence to schema version 2 with explicit `backupStartedAt`, accurate `backupCompletedAt`, and exact restore timestamps.
4. Preserve existing RPO/RTO, representative-data, isolated-target, fingerprint and encryption controls.
5. Update the recovery runbook/documentation to describe the stronger provenance contract.
6. Validate the exact branch with the permanent CI suite and the dedicated backup/restore smoke workflow.

## Acceptance criteria

- Short, uppercase or otherwise non-canonical release IDs fail closed before any dump is written.
- `releaseCommitSha` in PASS evidence is always a full lowercase 40-character SHA.
- `backupStartedAt` and `backupCompletedAt` reflect the actual `pg_dump` process window.
- `restoreStartedAt` and `restoreCompletedAt` reflect the actual `pg_restore` process window.
- `backupDurationMs` and `restoreDurationMs` are derived from those same captured process timestamps.
- Recovery evidence uses schema version 2.
- Existing source/restore fingerprint equality, isolation, reset acknowledgement, representative-data and RPO/RTO checks remain unchanged.
- The disposable CI recovery smoke remains explicitly non-representative and cannot satisfy the controlled-pilot representative-recovery gate.

## Non-goals

- Do not claim the disposable CI smoke is representative production recovery evidence.
- Do not weaken encrypted-storage requirements for live-data drills.
- Do not retain database dumps by default.
