# Event Commerce OS — Cloud Backup and Restore Evidence Drill

This runbook produces the evidence required by Task 010 SEC-006. It is a **destructive restore drill against an explicitly isolated target database**. It never resets the source database.

A script existing in the repository is not restore evidence. SEC-006 closes only after the drill has actually completed successfully against representative release-candidate data and the evidence manifest has been reviewed.

## What the drill proves

The drill:

1. opens a read-only repeatable-read transaction on the source Cloud database;
2. exports a PostgreSQL snapshot;
3. fingerprints every table in the `public` schema inside that snapshot;
4. runs `pg_dump` custom format using the exact exported snapshot;
5. SHA-256 hashes and archive-validates the dump;
6. resolves the actual source and restore PostgreSQL server/database identities and refuses to continue if they are the same;
7. requires an exact target-database reset acknowledgement;
8. resets only the restore target's `public` schema;
9. restores with `pg_restore --exit-on-error --no-owner --no-privileges`;
10. fingerprints every restored public table and requires an exact table-list/count/content match;
11. requires representative configuration, commerce, payment, inventory, audit, event-close and security data by default;
12. writes a PASS/FAIL JSON evidence manifest containing counts/fingerprints/timings/tool versions/checksums, never raw rows or database passwords.

The source fingerprints and `pg_dump` use the same exported snapshot, so normal concurrent source writes do not create a false source-vs-restore mismatch.

## Prerequisites

- PostgreSQL client tools (`pg_dump` and `pg_restore`) compatible with the Cloud PostgreSQL server. The repository development database uses PostgreSQL 16.
- Node/pnpm dependencies installed for `@event-commerce/cloud-api`.
- A **separate disposable PostgreSQL database** for restore verification.
- A named operator/change reference for the evidence record.
- Explicit RPO and RTO targets agreed for the pilot.
- For live/production data: an output location encrypted at rest and `BACKUP_ENCRYPTED_STORAGE_CONFIRMED=true`.

Do not put database credentials, access tokens or dump files in source control. `artifacts/backup-restore/` is gitignored.

## Local disposable restore target

The compose file includes an optional isolated restore database:

```bash
docker compose -f infra/docker-compose.yml --profile restore-drill up -d cloud-db cloud-restore-db
```

Local development URLs:

```text
source:  postgresql://event_commerce:localdev_only@localhost:5432/event_commerce_cloud
restore: postgresql://event_commerce:localdev_only@localhost:5434/event_commerce_cloud_restore
```

The restore script will still resolve both live PostgreSQL identities and refuse to reset the target if they resolve to the same database.

## Required environment

```bash
export DATABASE_URL='<source Cloud PostgreSQL URL>'
export RESTORE_DATABASE_URL='<isolated restore PostgreSQL URL>'
export RESTORE_TARGET_RESET_ACK='RESET:<restore database name>'
export BACKUP_OPERATOR='<named operator/change ticket>'
export RELEASE_COMMIT_SHA='<exact release commit SHA>'
export BACKUP_RPO_TARGET_MINUTES='<agreed target>'
export BACKUP_RTO_TARGET_MINUTES='<agreed target>'
```

For a live/production-data drill also set:

```bash
export BACKUP_LIVE_DATA=true
export BACKUP_ENCRYPTED_STORAGE_CONFIRMED=true
```

Optional:

```bash
export BACKUP_OUTPUT_DIR='artifacts/backup-restore'
export BACKUP_KEEP_DUMP=false
export BACKUP_REQUIRE_REPRESENTATIVE_DATA=true
```

`BACKUP_KEEP_DUMP=false` is the safer default for a verification drill. If a dump must be retained as a real backup artifact, store it only in the approved encrypted backup location and protect the resulting file as production data.

## Run

```bash
pnpm --filter @event-commerce/cloud-api backup-restore-evidence
```

A successful run prints the evidence path, dump SHA-256, backup duration, restore duration and number of public tables verified.

## Evidence output

Default output directory:

```text
artifacts/backup-restore/<timestamp>-<commit>/
```

Files:

- `backup-restore-evidence.json` — PASS/FAIL evidence manifest;
- `cloud-backup.dump.sha256` — dump checksum;
- `cloud-backup.dump` — present only when `BACKUP_KEEP_DUMP=true` or when a failure occurs before cleanup.

The JSON manifest includes:

- release commit and named operator;
- source/restore database identity without passwords;
- source snapshot/backup/restore timestamps;
- measured backup and restore durations;
- measured recovery-point age when restore begins;
- configured RPO/RTO targets and pass/fail against the drill measurements;
- dump SHA-256 and size;
- representative-domain checks;
- every public table's row count and deterministic content fingerprint;
- PostgreSQL dump/restore tool versions.

The manifest does **not** contain business rows, customer/payment card data, bearer credentials or database passwords.

## Representative-data gate

Release evidence defaults to `BACKUP_REQUIRE_REPRESENTATIVE_DATA=true`. It requires non-empty evidence for:

- organisations/events;
- synced commerce order state;
- payments and payment attempts;
- inventory ledger;
- audit history;
- immutable event-close reports;
- Edge machine identity registry;
- human operator identity registry.

For a developer smoke test only, this may be disabled:

```bash
export BACKUP_REQUIRE_REPRESENTATIVE_DATA=false
```

A smoke test with that override is **not** SEC-006 release evidence.

## RPO and RTO interpretation

The drill records:

- **restore duration** and compares it with `BACKUP_RTO_TARGET_MINUTES`;
- **recovery-point age at restore start** and compares it with `BACKUP_RPO_TARGET_MINUTES`.

A single successful drill cannot prove operational RPO by itself. Real RPO also depends on backup cadence and retention. The pilot evidence pack must therefore record the production backup schedule and show that the maximum scheduled backup age meets the agreed RPO target.

## Failure handling

A failed stage writes a sanitized `result: "FAIL"` manifest where possible, including the failed stage and error message.

If failure occurs after the restore target has been reset, treat the restore database as disposable/partial. Do not use it as a recovery source. Correct the cause and run a fresh drill.

Do not weaken fingerprint checks to make a restore pass. If a table list, row count or content fingerprint differs, the restore has not been proven faithful.

## Release sign-off

SEC-006 is complete only when the evidence pack contains:

- a PASS manifest from the exact release-candidate commit;
- representative-data checks all true;
- no table fingerprint mismatch;
- RTO drill target passed;
- RPO drill target passed and real backup cadence separately meets that target;
- encrypted backup-storage evidence for live data;
- named operator/reviewer sign-off;
- a retained copy of the evidence manifest/checksum outside the disposable restore environment.
