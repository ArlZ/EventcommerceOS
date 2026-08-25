import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyOperationalRecoveryEvidence } from './recovery-operational-evidence.mjs';

const releaseCommit = 'a'.repeat(40);
const backupSha = 'b'.repeat(64);

function restoreEvidence() {
  return {
    schemaVersion: 2,
    result: 'PASS',
    releaseCommitSha: releaseCommit,
    operator: 'change-operator-1',
    source: { host: 'primary.db.internal', port: 5432, database: 'event_commerce' },
    restoreTarget: { host: 'restore.db.internal', port: 5432, database: 'event_commerce_restore' },
    sourceSnapshotAt: '2026-08-25T08:00:00.000Z',
    backupStartedAt: '2026-08-25T08:00:01.000Z',
    backupCompletedAt: '2026-08-25T08:02:00.000Z',
    restoreStartedAt: '2026-08-25T08:02:01.000Z',
    restoreCompletedAt: '2026-08-25T08:07:00.000Z',
    backupDurationMs: 119000,
    restoreDurationMs: 299000,
    recoveryPointAgeAtRestoreStartMs: 121000,
    targets: {
      rpoMinutes: 30,
      rtoMinutes: 15,
      drillRecoveryPointWithinRpoTarget: true,
      restoreWithinRtoTarget: true,
    },
    dump: {
      sha256: backupSha,
      bytes: 500000,
      retained: true,
      archiveListValidated: true,
      encryptedStorageConfirmed: true,
    },
    representativeData: {
      organisationAndEvent: true,
      commerceOrders: true,
      payments: true,
      inventoryLedger: true,
      auditHistory: true,
      eventClose: true,
      edgeIdentity: true,
      humanOperatorIdentity: true,
    },
    publicTableCount: 2,
    tableFingerprints: {
      events: { rowCount: '1', fingerprint: '1'.repeat(32), primaryKey: ['id'] },
      payments: { rowCount: '100', fingerprint: '2'.repeat(32), primaryKey: ['id'] },
    },
  };
}

function backupRecord(snapshotAt, completedAt, suffix) {
  const retainedThrough = '2026-09-30T00:00:00.000Z';
  return {
    snapshotAt,
    completedAt,
    sha256: `${suffix}`.repeat(64).slice(0, 64),
    bytes: 400000 + Number(suffix),
    sourceEvidenceRef: `provider-export/backup-${suffix}.json`,
    copies: [
      {
        failureDomain: 'hostinger-primary',
        encryptedAtRest: true,
        checksumVerified: true,
        sha256: `${suffix}`.repeat(64).slice(0, 64),
        retainedThrough,
      },
      {
        failureDomain: 'offsite-object-storage',
        encryptedAtRest: true,
        checksumVerified: true,
        sha256: `${suffix}`.repeat(64).slice(0, 64),
        retainedThrough,
      },
    ],
  };
}

function manifest() {
  return {
    schemaVersion: 1,
    releaseCommit,
    dataClass: 'REPRESENTATIVE_RELEASE',
    observationEndedAt: '2026-08-25T10:00:00.000Z',
    policy: {
      rpoMinutes: 30,
      rtoMinutes: 15,
      cadenceMinutes: 20,
      retentionDays: 30,
      primaryFailureDomain: 'hostinger-primary',
    },
    backupRecords: [
      backupRecord('2026-08-25T09:00:00.000Z', '2026-08-25T09:02:00.000Z', '1'),
      backupRecord('2026-08-25T09:20:00.000Z', '2026-08-25T09:22:00.000Z', '2'),
      backupRecord('2026-08-25T09:40:00.000Z', '2026-08-25T09:42:00.000Z', '3'),
    ],
  };
}

test('passes representative restore plus observed cadence and separate failure-domain retention', () => {
  const report = verifyOperationalRecoveryEvidence({
    manifest: manifest(),
    restoreEvidence: restoreEvidence(),
    now: new Date('2026-08-25T10:05:00.000Z'),
  });
  assert.equal(report.status, 'PASS');
  assert.equal(report.operationalRecoverySatisfied, true);
  assert.equal(report.humanReviewRequired, true);
  assert.equal(report.liveMoneyApproved, false);
  assert.equal(report.maximumObservedBackupGapMs, 20 * 60_000);
  assert.equal(report.latestRecoveryPointAgeMs, 20 * 60_000);
});

test('fails when declared backup cadence is looser than RPO', () => {
  const input = manifest();
  input.policy.cadenceMinutes = 45;
  const report = verifyOperationalRecoveryEvidence({
    manifest: input,
    restoreEvidence: restoreEvidence(),
  });
  assert.equal(report.status, 'FAIL');
  assert.equal(
    report.checks.find((entry) => entry.id === 'cadence:declared-policy-within-rpo')?.status,
    'FAIL',
  );
});

test('fails when observed backups exceed the declared cadence', () => {
  const input = manifest();
  input.backupRecords[1].snapshotAt = '2026-08-25T09:25:00.000Z';
  const report = verifyOperationalRecoveryEvidence({
    manifest: input,
    restoreEvidence: restoreEvidence(),
  });
  assert.equal(report.status, 'FAIL');
  assert.equal(report.checks.find((entry) => entry.id === 'cadence:observed-gap')?.status, 'FAIL');
});

test('fails when the latest recovery point is older than RPO at observation end', () => {
  const input = manifest();
  input.backupRecords.pop();
  input.backupRecords.push(
    backupRecord('2026-08-25T09:25:00.000Z', '2026-08-25T09:27:00.000Z', '3'),
  );
  input.observationEndedAt = '2026-08-25T10:00:01.000Z';
  const report = verifyOperationalRecoveryEvidence({
    manifest: input,
    restoreEvidence: restoreEvidence(),
  });
  assert.equal(report.status, 'FAIL');
  assert.equal(
    report.checks.find((entry) => entry.id === 'cadence:latest-recovery-point-age')?.status,
    'FAIL',
  );
});

test('fails if backup copies are not independently retained in another failure domain', () => {
  const input = manifest();
  input.backupRecords[0].copies[1].failureDomain = 'hostinger-primary';
  const report = verifyOperationalRecoveryEvidence({
    manifest: input,
    restoreEvidence: restoreEvidence(),
  });
  assert.equal(report.status, 'FAIL');
  assert.equal(
    report.checks.find((entry) => entry.id === 'cadence:record-integrity')?.status,
    'FAIL',
  );
});

test('fails if retained copy checksum or encryption proof is missing', () => {
  const input = manifest();
  input.backupRecords[1].copies[1].checksumVerified = false;
  input.backupRecords[2].copies[1].encryptedAtRest = false;
  const report = verifyOperationalRecoveryEvidence({
    manifest: input,
    restoreEvidence: restoreEvidence(),
  });
  assert.equal(report.status, 'FAIL');
});

test('fails on restore release mismatch or incomplete representative data', () => {
  const restore = restoreEvidence();
  restore.releaseCommitSha = 'c'.repeat(40);
  restore.representativeData.payments = false;
  const report = verifyOperationalRecoveryEvidence({ manifest: manifest(), restoreEvidence: restore });
  assert.equal(report.status, 'FAIL');
  assert.equal(
    report.checks.find((entry) => entry.id === 'restore:release-identity')?.status,
    'FAIL',
  );
  assert.equal(
    report.checks.find((entry) => entry.id === 'restore:representative-data')?.status,
    'FAIL',
  );
});

test('LIVE evidence additionally requires encrypted dump storage confirmation', () => {
  const input = manifest();
  input.dataClass = 'LIVE';
  const restore = restoreEvidence();
  restore.dump.encryptedStorageConfirmed = false;
  const report = verifyOperationalRecoveryEvidence({ manifest: input, restoreEvidence: restore });
  assert.equal(report.status, 'FAIL');
  assert.equal(report.checks.find((entry) => entry.id === 'restore:live-encryption')?.status, 'FAIL');
});
