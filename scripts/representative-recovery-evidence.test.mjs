import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyRepresentativeRecoveryFieldEvidence } from './representative-recovery-evidence.mjs';
const releaseCommit = 'c'.repeat(40);
const backupSha = 'd'.repeat(64);
function passingManifest() {
  return {
    schemaVersion: 1,
    releaseCommit,
    operator: 'Recovery Operator',
    reviewer: 'Recovery Reviewer',
    liveMoneyApproved: false,
    liveOrProductionData: false,
    productionBackupCadenceMinutes: 10,
    productionBackupScheduleVerified: true,
    isolatedRestoreTargetVerified: true,
    evidenceRetainedOutsideRestoreTarget: true,
  };
}
function passingBackupEvidence() {
  return {
    schemaVersion: 2,
    result: 'PASS',
    releaseCommitSha: releaseCommit,
    operator: 'Recovery Operator',
    source: { host: 'db-source', port: '5432', database: 'event_cloud' },
    restoreTarget: { host: 'db-restore', port: '5432', database: 'event_cloud_restore' },
    restoreDurationMs: 120000,
    recoveryPointAgeAtRestoreStartMs: 180000,
    targets: {
      rpoMinutes: 15,
      rtoMinutes: 10,
      drillRecoveryPointWithinRpoTarget: true,
      restoreWithinRtoTarget: true,
    },
    dump: {
      sha256: 'e'.repeat(64),
      archiveListValidated: true,
      encryptedStorageConfirmed: false,
    },
    publicTableCount: 46,
    representativeData: {
      configuration: true,
      commerce: true,
      payments: true,
      inventory: true,
      audit: true,
      close: true,
      machineSecurity: true,
      humanSecurity: true,
    },
  };
}
test('representative recovery verifier passes complete exact-release evidence', () => {
  const report = verifyRepresentativeRecoveryFieldEvidence({
    manifest: passingManifest(),
    backupEvidence: passingBackupEvidence(),
    backupEvidenceSha256: backupSha,
    now: new Date('2026-08-27T09:45:00+03:00'),
  });
  assert.equal(report.status, 'PASS');
  assert.equal(report.representativeRecoverySatisfied, true);
  assert.equal(report.liveMoneyApproved, false);
  assert.equal(report.backupEvidence.publicTableCount, 46);
  assert.match(report.reportDigestSha256, /^[0-9a-f]{64}$/);
});
test('representative recovery verifier rejects synthetic or incomplete representative data', () => {
  const evidence = passingBackupEvidence();
  evidence.representativeData.payments = false;
  const report = verifyRepresentativeRecoveryFieldEvidence({
    manifest: passingManifest(),
    backupEvidence: evidence,
    backupEvidenceSha256: backupSha,
  });
  assert.equal(report.status, 'FAIL');
  assert.match(
    report.checks.find((entry) => entry.id === 'backup-restore-evidence')?.details ?? '',
    /representativeData.payments/,
  );
});
test('representative recovery verifier fails when production cadence exceeds RPO target', () => {
  const manifest = passingManifest();
  manifest.productionBackupCadenceMinutes = 30;
  const report = verifyRepresentativeRecoveryFieldEvidence({
    manifest,
    backupEvidence: passingBackupEvidence(),
    backupEvidenceSha256: backupSha,
  });
  assert.equal(report.status, 'FAIL');
  assert.equal(
    report.checks.find((entry) => entry.id === 'production-backup-cadence')?.status,
    'FAIL',
  );
});
test('representative recovery verifier requires encrypted storage for live data', () => {
  const manifest = passingManifest();
  manifest.liveOrProductionData = true;
  const report = verifyRepresentativeRecoveryFieldEvidence({
    manifest,
    backupEvidence: passingBackupEvidence(),
    backupEvidenceSha256: backupSha,
  });
  assert.equal(report.status, 'FAIL');
  assert.equal(report.checks.find((entry) => entry.id === 'encrypted-storage')?.status, 'FAIL');
});
test('representative recovery verifier rejects same source and restore database', () => {
  const evidence = passingBackupEvidence();
  evidence.restoreTarget = { ...evidence.source };
  const report = verifyRepresentativeRecoveryFieldEvidence({
    manifest: passingManifest(),
    backupEvidence: evidence,
    backupEvidenceSha256: backupSha,
  });
  assert.equal(report.status, 'FAIL');
  assert.match(
    report.checks.find((entry) => entry.id === 'backup-restore-evidence')?.details ?? '',
    /different databases/,
  );
});
test('representative recovery verifier never approves live money', () => {
  const manifest = passingManifest();
  manifest.liveMoneyApproved = true;
  const report = verifyRepresentativeRecoveryFieldEvidence({
    manifest,
    backupEvidence: passingBackupEvidence(),
    backupEvidenceSha256: backupSha,
  });
  assert.equal(report.status, 'FAIL');
  assert.equal(report.liveMoneyApproved, false);
});
