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
12. writes a PASS JSON evidence manifest containing exact-release identity, counts/fingerprints, actual process timings, tool versions and checksums, never raw rows or database passwords.

The source fingerprints and `pg_dump` use the same exported snapshot, so normal concurrent source writes do not create a false source-vs-restore mismatch.

## Prerequisites

- PostgreSQL client tools (`pg_dump` and `pg_restore`) compatible with the Cloud PostgreSQL server. The repository development database uses PostgreSQL 16.
- Node/pnpm dependencies installed for `@event-commerce/cloud-api`.
- A **separate disposable PostgreSQL database** for restore verification.
- A named operator/change reference for the evidence record.
- The full lowercase 40-character Git SHA for the exact release candidate being exercised.
- Explicit RPO and RTO targets agreed for the pilot.
- For live/production data: an output location encrypted at rest and `BACKUP_ENCRYPTED_STORAGE_CONFIRMED=true`.

Do not put database credentials, access tokens or dump files in source control. `artifacts/backup-restore/` is gitignored.

## Local disposable restore target

The compose file includes an optional isolated restore database under the `restore-drill` profile. It uses tmpfs so the disposable restore contents are not persisted as a normal development volume.

```bash
docker compose -f infra/docker-compose.yml --profile restore-drill up -d \
  cloud-postgres cloud-restore-postgres
```

Local development URLs:

```text
source:  postgresql://event_commerce:localdev_only@localhost:5432/event_commerce_cloud
restore: postgresql://event_commerce:localdev_only@localhost:5434/event_commerce_cloud_restore
```

The restore script still resolves both PostgreSQL identities and refuses to reset the target if they resolve to the same database.

## Required environment

```bash
export DATABASE_URL='<source Cloud PostgreSQL URL>'
export RESTORE_DATABASE_URL='<isolated restore PostgreSQL URL>'
export RESTORE_TARGET_RESET_ACK='RESET:<restore database name>'
export BACKUP_OPERATOR='<named operator/change ticket>'
export RELEASE_COMMIT_SHA='<full lowercase 40-character exact release commit SHA>'
export BACKUP_RPO_TARGET_MINUTES='<agreed target>'
export BACKUP_RTO_TARGET_MINUTES='<agreed target>'
```

`RELEASE_COMMIT_SHA` is deliberately strict. Short SHAs, uppercase hexadecimal and branch/tag names are rejected so recovery evidence cannot be ambiguously attributed to a release.

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

- `backup-restore-evidence.json` — PASS evidence manifest;
- `cloud-backup.dump.sha256` — dump checksum;
- `cloud-backup.dump` — present only when `BACKUP_KEEP_DUMP=true` or when a failure occurs before cleanup.

The schema-version-2 JSON manifest includes:

- the full exact release commit and named operator;
- source/restore database identity without passwords;
- source snapshot timestamp;
- actual `pg_dump` process start/completion timestamps and measured duration;
- actual `pg_restore` process start/completion timestamps and measured duration;
- measured recovery-point age when restore begins;
- configured RPO/RTO targets and pass/fail against the drill measurements;
- dump SHA-256 and size;
- representative-domain checks;
- every public table's row count and deterministic content fingerprint;
- PostgreSQL dump/restore tool versions.

The timestamps come from the same clock used to calculate each process duration. `backupCompletedAt` is therefore the actual observed `pg_dump` completion time, not a value reconstructed from the source snapshot time.

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

A smoke test with that override is **not** SEC-006 release evidence and cannot satisfy the controlled-pilot `representativeRecovery` gate.

## CI representative recovery rehearsal

The `Backup restore smoke` workflow no longer bypasses the representative-data checks. After applying the exact release migrations to a fresh local PostgreSQL service, it runs:

```bash
pnpm --filter @event-commerce/cloud-api recovery:seed-representative
```

The fixture command is deliberately guarded:

- it refuses `NODE_ENV=production`;
- it refuses every non-local PostgreSQL hostname;
- it requires `RECOVERY_FIXTURE_ACK=SEED:<database name>`;
- it requires the migrated operational tables to be empty;
- it requires at least 100 orders and caps the fixture at 10,000 orders.

CI currently seeds 250 closed orders with matching payments and payment attempts, inventory Edge events and ledger movements, audit history, an immutable event-close report, an Edge machine identity and a human operator identity. The subsequent backup/restore command runs with `BACKUP_REQUIRE_REPRESENTATIVE_DATA=true`, so the same representative-domain gate used by the release drill must pass before CI evidence can be produced.

This rehearsal is valuable automated evidence that the exact release schema, backup archive, restore path and fingerprint verifier work on an event-scale multi-domain dataset. It is **not by itself final SEC-006 approval**. The controlled-pilot recovery gate still requires the approved release-candidate dataset or live-data drill as applicable, production backup-cadence evidence, agreed RPO/RTO targets, retained evidence and a named human reviewer.

## RPO and RTO interpretation

The drill records:

- **restore duration** and compares it with `BACKUP_RTO_TARGET_MINUTES`;
- **recovery-point age at restore start** and compares it with `BACKUP_RPO_TARGET_MINUTES`.

A single successful drill cannot prove operational RPO by itself. Real RPO also depends on backup cadence and retention. The pilot evidence pack must therefore record the production backup schedule and show that the maximum scheduled backup age meets the agreed RPO target.

## Failure handling

The script fails closed before writing PASS evidence if any required precondition or verification stage fails.

If failure occurs after the restore target has been reset, treat the restore database as disposable/partial. Do not use it as a recovery source. Correct the cause and run a fresh drill.

Do not weaken fingerprint checks to make a restore pass. If a table list, row count or content fingerprint differs, the restore has not been proven faithful.

## Release sign-off

SEC-006 is complete only when the evidence pack contains:

- a PASS manifest from the exact full release-candidate commit;
- representative-data checks all true;
- no table fingerprint mismatch;
- RTO drill target passed;
- RPO drill target passed and real backup cadence separately meets that target;
- encrypted backup-storage evidence for live data;
- named operator/reviewer sign-off;
- a retained copy of the evidence manifest/checksum outside the disposable restore environment.

When preparing the controlled-pilot evidence manifest, retain this recovery evidence under the pilot evidence directory and generate its digest-bound reference with `pnpm pilot:evidence:hash` before human review.
