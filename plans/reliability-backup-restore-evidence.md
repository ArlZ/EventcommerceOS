# Reliability remediation — Cloud backup and restore evidence

Status: implementation complete; final green abuse-controls base merged; permanent CI revalidation in progress; representative restore evidence remains a release-time requirement
Base: final `security/abuse-controls` at `9e330b9da38d14726ebd6c86394ca2eb451e5081`

## Objective

Turn Task 010 SEC-006 from a prose requirement into a repeatable PostgreSQL backup/isolated-restore verification drill that produces machine-readable evidence without committing database contents or credentials.

This branch can make the drill executable and reviewable. It must **not** claim SEC-006 is closed until the drill has actually run against a representative Cloud database and isolated restore target and the resulting evidence has been reviewed.

## Drill design

1. Open a read-only repeatable-read transaction on the source Cloud database.
2. Export the PostgreSQL snapshot and compute source fingerprints inside that same snapshot.
3. Run PostgreSQL 16 `pg_dump` in custom format against the exported snapshot.
4. Record dump SHA-256, size, snapshot timestamp and backup duration.
5. Validate the archive with `pg_restore --list` before touching the restore target.
6. Require an explicit database-name acknowledgement before destructively resetting the isolated restore database's `public` schema.
7. Restore with `pg_restore --exit-on-error --no-owner --no-privileges`.
8. Compute the same table fingerprints on the restored database.
9. Fail unless all critical table counts/fingerprints match exactly.
10. Require representative commerce, payment, inventory, audit and close data by default so an empty-database restore cannot satisfy the release gate.
11. Write a JSON evidence manifest containing only counts/fingerprints/timings/tool versions/checksums—not raw rows or connection credentials.

## Critical restore surface

Fingerprint at minimum:

- `schema_migrations`;
- organisations/events;
- validated synced order state and processed sync events;
- payments/payment attempts/refunds/reversals/provider events;
- inventory ledger and Edge inventory event history;
- audit history;
- immutable event-close reports/actions;
- Edge machine credential registry/audit;
- human operator identities/memberships/sessions/audit.

Security credentials remain digest-only in the database; the evidence manifest contains only a table fingerprint.

## Safety invariants

- Source and restore database endpoints must differ.
- Restore target reset requires an exact acknowledgement containing the target database name.
- Database passwords are passed to PostgreSQL tools through `PGPASSWORD`, never command-line connection URLs.
- Dump file permissions are restricted to the current OS user.
- Live/production drill requires explicit confirmation that the output location is encrypted at rest.
- Backup artifacts are gitignored.
- Dump retention is opt-in; the drill may delete the dump after successful verification while retaining checksum/evidence.
- Restore verification cannot pass on row counts alone; deterministic content fingerprints must match.
- The source fingerprint and `pg_dump` use the same exported PostgreSQL snapshot, so normal concurrent event activity cannot create a false mismatch.
- The drill records measured backup duration, restore duration and recovery-point age at restore completion. Actual operational RPO still depends on backup cadence and must be recorded separately in deployment policy.

## Repository CI checkpoint

The final green PR #18 abuse-controls head merged into this branch without conflicts. The branch is now zero commits behind its base and the PR diff has collapsed to five intended backup/restore evidence files: the drill script, package entrypoint, gitignore rule, operator documentation and this plan. All runtime security/auth/abuse fixes are inherited from the proven base rather than duplicated in this evidence layer.

A fresh permanent CI pass on this exact re-linked head is required before merge readiness. Passing repository CI proves the evidence tooling integrates cleanly; it does **not** substitute for executing the restore drill against representative release-candidate data.

## Remaining evidence gate

SEC-006 closes only after:

- this drill executes against representative release-candidate data;
- the isolated restore succeeds;
- all critical fingerprints match;
- the evidence manifest is retained with release commit/operator/timestamps;
- the measured restore duration is reviewed against the pilot RTO target;
- backup cadence is reviewed against the pilot RPO target.