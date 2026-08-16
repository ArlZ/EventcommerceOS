# Reliability — migration ledger completeness

Status: **in progress (stacked behind PR #54)**
Base: administrative DB-target candidate `c2ad6126d5ebd578e71ade4704a385c0c0a6676c`

## Objective

Extend checksum-bound migration history so the runner also detects missing historical files and out-of-order backfilled migrations.

## Scope

1. Compare every applied migration ledger filename with the current repository migration set before applying anything new.
2. Fail if an applied migration filename is missing from the repository (including delete/rename cases).
3. If migrations have already been applied, fail if a newly discovered migration sorts at or before the greatest applied filename.
4. Preserve normal append-only forward migration behavior.
5. After all current legacy rows have been baselined, enforce non-null lowercase SHA-256 format in the migration ledger database schema.
6. Extend permanent CI with real runner probes for deleted historical files and backfilled migration ordering.
7. Extend pure helper tests for inventory completeness and ordering.

## Acceptance criteria

- Deleting or renaming an applied Cloud or Edge migration causes the real migration command to fail before later migrations execute.
- Adding an unapplied migration that sorts before already-applied history fails closed.
- A new migration that sorts after all applied history remains eligible for normal application.
- Migration checksum columns become non-null after legacy baselining and are constrained to lowercase 64-character SHA-256.
- Existing checksum drift rejection remains intact.
- Full CI, SCA, secret scan and production runtime-container migration smoke remain green.

## Non-goals

- Do not infer semantic dependencies between migrations beyond deterministic filename ordering.
- Do not rename existing migrations.
- Do not create down migrations or automatic history repair.
- Do not claim legacy checksums provide historical attestation before their baseline date.
