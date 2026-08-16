# Migration integrity

Cloud API and Event Edge migrations are append-only deployment artifacts. Once a migration filename has been applied to a database, changing, deleting, renaming or inserting history behind that point can make source control and database state disagree.

The migration runners therefore bind each applied filename to SHA-256 of the exact UTF-8 SQL bytes and validate the complete applied-file inventory before applying anything new.

## New databases and migrations

Each migration ledger stores:

- migration filename;
- lowercase SHA-256 checksum of the SQL file;
- applied timestamp.

The checksum is inserted in the same transaction as the migration itself. On later runs, the migration runner reads the file again and requires the stored checksum to match before it skips the already-applied migration.

After legacy rows have been baselined, the database ledger requires a non-null 64-character lowercase hexadecimal SHA-256 value for every migration row.

A checksum mismatch is a hard deployment failure. Do not update the stored checksum to make a changed historical migration pass. Restore the original migration bytes and create a new forward migration instead.

## Applied-file completeness and ordering

Before applying new SQL, the runner compares repository filenames with the migration ledger under the existing advisory lock.

It fails closed if:

- a filename recorded as applied is no longer present in the repository, including deletion or rename cases; or
- a migration that is not yet applied sorts at or before the greatest applied filename.

This preserves deterministic append-only history. A new migration must sort strictly after all already-applied migrations. The runner does not attempt to infer semantic dependencies or repair reordered history automatically.

## Existing databases

Databases created before checksum support have migration rows with no checksum. Under the existing migration advisory lock, the first checksum-aware migration run calculates the checksum of each matching current SQL file and records it as a **one-time baseline**.

This baseline means future byte drift is detectable. It does **not** prove that the current file is byte-for-byte identical to what was originally applied before checksum support existed. Treat that distinction explicitly in release review.

The runner only tightens the checksum column to non-null after all current ledger rows have passed inventory validation and any legacy checksum baseline has completed.

## Database target safety

Production migration execution is fail-closed:

- Cloud API requires explicit `DATABASE_URL` when `NODE_ENV=production`;
- Event Edge requires explicit `EDGE_DATABASE_URL` when `NODE_ENV=production`;
- Event Edge will not reuse generic `DATABASE_URL` in production.

Local/test execution retains the existing developer fallbacks.

## CI evidence

Permanent CI applies both migration sets and exercises the real migration runners against several failure modes:

1. changes an already-applied migration and requires checksum-drift rejection;
2. temporarily removes an applied migration and requires missing-history rejection;
3. introduces an unapplied migration that sorts before existing history and requires out-of-order rejection;
4. restores the repository and proves both migration commands rerun cleanly with no tracked diff.

The production runtime-container workflow separately executes the packaged Cloud and Edge migration runners from the actual production images. This confirms the integrity helpers and ledger constraints are included in deployable artifacts.

## Operational rule

Never edit, delete, rename or backfill behind applied migration history. Add a new monotonically ordered forward migration. If an integrity check fails unexpectedly, stop deployment and investigate source/database provenance rather than bypassing or rewriting the ledger.
