# Reliability follow-on — backup/restore smoke CI

Status: implementation in progress; synthetic CI evidence must not be treated as SEC-006 release evidence
Base: `security/dependency-sca-evidence` (PR #20)

## Objective

Continuously prove that the PostgreSQL backup/isolated-restore evidence mechanism remains mechanically executable as migrations and Cloud persistence evolve.

This slice protects the recovery tooling from silent rot. It does **not** close SEC-006 and does not replace the representative release-candidate restore drill in `docs/BACKUP_RESTORE.md`.

## Smoke design

The permanent workflow uses two disposable PostgreSQL 16 service databases:

- a source database that receives the normal Cloud migrations;
- a distinct restore database that is explicitly acknowledged as destructive-reset safe.

The workflow then runs the real `backup-restore-evidence` command with `BACKUP_REQUIRE_REPRESENTATIVE_DATA=false`, validates the dump archive, restores into the isolated target, compares table/fingerprint truth, checks restored sequence safety, evaluates the configured smoke RPO/RTO thresholds and retains the JSON evidence artifact.

## Safety invariants

- Source and restore databases are separate disposable CI services.
- The restore target reset requires the exact `RESET:<database>` acknowledgement.
- No live or production data is used.
- The dump is deleted after the smoke by default; only non-sensitive evidence is retained.
- The workflow uses the repository's real recovery script rather than a second test-only implementation.
- Any dump, restore, fingerprint, sequence or evidence failure makes the smoke fail closed.
- The representative-data gate is disabled only because the CI databases are intentionally synthetic and empty of business traffic.

## Non-goals

- Proving real backup cadence or operational RPO.
- Proving restore time on production-sized data or production infrastructure.
- Demonstrating encrypted live-data backup storage.
- Closing SEC-006.
- Replacing the named operator/reviewer sign-off on a representative release-candidate restore.

## Acceptance criteria

- Cloud migrations execute against the disposable source database.
- The documented `pnpm --filter @event-commerce/cloud-api backup-restore-evidence` command runs successfully.
- The custom-format archive validates before restore.
- Restore happens only into the distinct acknowledged target database.
- Restored public tables, counts and content fingerprints match the source snapshot.
- Restored sequence safety checks pass.
- Synthetic RPO/RTO checks pass for the smoke thresholds.
- JSON evidence is uploaded even when the smoke fails, where available.
- Documentation and PR disposition explicitly state that representative SEC-006 evidence remains mandatory.
