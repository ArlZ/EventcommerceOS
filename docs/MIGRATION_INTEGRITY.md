# Migration integrity

Cloud API and Event Edge migrations are append-only deployment artifacts. Once a migration filename has been applied to a database, changing that file later can make source control and database history disagree even though the migration runner skips the filename.

The migration runners therefore bind each applied filename to SHA-256 of the exact UTF-8 SQL bytes.

## New databases and migrations

Each migration ledger stores:

- migration filename;
- lowercase SHA-256 checksum of the SQL file;
- applied timestamp.

The checksum is inserted in the same transaction as the migration itself. On later runs, the migration runner reads the file again and requires the stored checksum to match before it skips the already-applied migration.

A checksum mismatch is a hard deployment failure. Do not update the stored checksum to make a changed historical migration pass. Restore the original migration bytes and create a new forward migration instead.

## Existing databases

Databases created before checksum support have migration rows with no checksum. Under the existing migration advisory lock, the first checksum-aware migration run calculates the checksum of each matching current SQL file and records it as a **one-time baseline**.

This baseline means future byte drift is detectable. It does **not** prove that the current file is byte-for-byte identical to what was originally applied before checksum support existed. Treat that distinction explicitly in release review.

## Database target safety

Production migration execution is fail-closed:

- Cloud API requires explicit `DATABASE_URL` when `NODE_ENV=production`;
- Event Edge requires explicit `EDGE_DATABASE_URL` when `NODE_ENV=production`;
- Event Edge will not reuse generic `DATABASE_URL` in production.

Local/test execution retains the existing developer fallbacks.

## CI evidence

Permanent CI applies both migration sets, deliberately changes an already-applied migration file, and requires the real migration runner to reject the checksum drift. CI then restores the tracked file, reruns both migration commands successfully and requires a clean Git diff before continuing to normal build/test gates.

The production runtime-container workflow separately executes the packaged Cloud and Edge migration runners from the actual production images. This confirms the helper modules and checksum-aware migration code are included in the deployable artifacts.

## Operational rule

Never edit an applied migration to correct or extend production state. Add a new monotonically ordered migration. If a checksum mismatch appears unexpectedly, stop deployment and investigate the source/database provenance rather than bypassing the integrity check.
