# Representative recovery field evidence

This verifier complements `docs/BACKUP_RESTORE.md` by checking that an exact-release backup/restore PASS manifest is suitable for controlled-pilot `representativeRecovery` review.

It does not run `pg_dump`/`pg_restore`, does not fabricate recovery evidence, and cannot approve live money.

## Before running this verifier

Run the destructive restore drill against an explicitly isolated target using representative controlled-pilot data:

```bash
pnpm --filter @event-commerce/cloud-api backup-restore-evidence
```

The underlying backup/restore evidence must already prove:

- exact 40-character release SHA;
- different source and restore database identities;
- PASS result;
- archive validation and dump SHA-256;
- representative configuration, commerce, payments, inventory, audit, immutable close, Edge machine identity and human operator identity;
- measured drill recovery point within RPO target;
- measured restore duration within RTO target.

## Review manifest

Create a small non-secret review manifest next to the backup evidence:

```json
{
  "schemaVersion": 1,
  "releaseCommit": "<40-character-release-sha>",
  "operator": "<named recovery operator>",
  "reviewer": "<named recovery reviewer>",
  "backupRestoreEvidencePath": "backup-restore-evidence.json",
  "productionBackupCadenceMinutes": 10,
  "productionBackupScheduleVerified": true,
  "liveOrProductionData": false,
  "isolatedRestoreTargetVerified": true,
  "evidenceRetainedOutsideRestoreTarget": true,
  "liveMoneyApproved": false
}
```

For live or production data, set `liveOrProductionData: true`. The underlying backup evidence must then have `dump.encryptedStorageConfirmed: true`.

`productionBackupCadenceMinutes` must be less than or equal to the RPO target recorded by the actual restore drill. This closes the gap between a one-off recovery-point measurement and the real scheduled backup cadence.

## Verify

```bash
pnpm pilot:recovery:verify -- \
  artifacts/pilot/recovery-review.json \
  artifacts/pilot/representative-recovery-field-evidence.json
```

The verifier hashes the retained backup/restore evidence bytes and emits a canonical digest-bound report. It fails closed for release mismatch, missing representative domains, same source/restore identity, failed RPO/RTO checks, cadence outside RPO, missing live-data encryption acknowledgement, or missing isolated-target/retention confirmation.

## What PASS means

A PASS report is suitable retained evidence for the `representativeRecovery` gate after it is digest-bound into the pilot manifest and reviewed by the named release reviewer.

It remains separate from the hardware/network, offline durability, payment fault, abuse/flood, inventory/reconciliation and controlled-pilot-close gates. The generated report always states `liveMoneyApproved: false`.
