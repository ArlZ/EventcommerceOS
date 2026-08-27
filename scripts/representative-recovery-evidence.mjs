import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const REPRESENTATIVE_DOMAINS = [
  'configuration',
  'commerce',
  'payments',
  'inventory',
  'audit',
  'close',
  'machineSecurity',
  'humanSecurity',
];

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

function digestObject(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function digestBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function check(id, passed, details) {
  return { id, status: passed ? 'PASS' : 'FAIL', details };
}

function sameDatabase(left, right) {
  return (
    left?.host === right?.host &&
    String(left?.port ?? '') === String(right?.port ?? '') &&
    left?.database === right?.database
  );
}

function validateBackupEvidence(evidence, manifest) {
  const errors = [];
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return ['backup restore evidence must be a JSON object'];
  }
  if (evidence.schemaVersion !== 2) errors.push('backup evidence schemaVersion must equal 2');
  if (evidence.result !== 'PASS') errors.push('backup evidence result must equal PASS');
  if (evidence.releaseCommitSha !== manifest.releaseCommit) {
    errors.push('backup evidence releaseCommitSha must match the exact release');
  }
  if (!nonEmpty(evidence.operator)) errors.push('backup evidence operator is required');
  if (!evidence.source || !evidence.restoreTarget) {
    errors.push('backup evidence source and restoreTarget identities are required');
  } else if (sameDatabase(evidence.source, evidence.restoreTarget)) {
    errors.push('backup evidence source and restoreTarget must be different databases');
  }
  if (!positiveInteger(evidence.targets?.rpoMinutes)) {
    errors.push('backup evidence targets.rpoMinutes must be a positive integer');
  }
  if (!positiveInteger(evidence.targets?.rtoMinutes)) {
    errors.push('backup evidence targets.rtoMinutes must be a positive integer');
  }
  if (evidence.targets?.drillRecoveryPointWithinRpoTarget !== true) {
    errors.push('backup evidence drillRecoveryPointWithinRpoTarget must be true');
  }
  if (evidence.targets?.restoreWithinRtoTarget !== true) {
    errors.push('backup evidence restoreWithinRtoTarget must be true');
  }
  if (!SHA256_PATTERN.test(evidence.dump?.sha256 ?? '')) {
    errors.push('backup evidence dump.sha256 must be a lowercase SHA-256 digest');
  }
  if (evidence.dump?.archiveListValidated !== true) {
    errors.push('backup evidence dump.archiveListValidated must be true');
  }
  if (!positiveInteger(evidence.publicTableCount)) {
    errors.push('backup evidence publicTableCount must be positive');
  }
  for (const domain of REPRESENTATIVE_DOMAINS) {
    if (evidence.representativeData?.[domain] !== true) {
      errors.push(`backup evidence representativeData.${domain} must be true`);
    }
  }
  return errors;
}

export function verifyRepresentativeRecoveryFieldEvidence({
  manifest,
  backupEvidence,
  backupEvidenceSha256,
  now = new Date(),
}) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('representative recovery manifest must be a JSON object');
  }

  const checks = [];
  checks.push(check('schema', manifest.schemaVersion === 1, 'schemaVersion must equal 1'));
  checks.push(
    check(
      'release',
      SHA_PATTERN.test(manifest.releaseCommit ?? ''),
      'releaseCommit must be a lowercase 40-character Git SHA',
    ),
  );
  checks.push(check('operator', nonEmpty(manifest.operator), 'operator is required'));
  checks.push(check('reviewer', nonEmpty(manifest.reviewer), 'reviewer is required'));
  checks.push(
    check(
      'live-money-boundary',
      manifest.liveMoneyApproved === false,
      'liveMoneyApproved must be explicitly false',
    ),
  );

  const evidenceErrors = validateBackupEvidence(backupEvidence, manifest);
  checks.push(
    check(
      'backup-restore-evidence',
      evidenceErrors.length === 0,
      evidenceErrors.length ? evidenceErrors.join('; ') : 'backup/restore evidence is valid',
    ),
  );

  checks.push(
    check(
      'backup-evidence-digest',
      SHA256_PATTERN.test(backupEvidenceSha256 ?? ''),
      'backup evidence file must have a SHA-256 digest',
    ),
  );

  const cadenceMinutes = manifest.productionBackupCadenceMinutes;
  const cadenceValid = positiveInteger(cadenceMinutes);
  const cadenceWithinRpo =
    cadenceValid &&
    positiveInteger(backupEvidence?.targets?.rpoMinutes) &&
    cadenceMinutes <= backupEvidence.targets.rpoMinutes;
  checks.push(
    check(
      'production-backup-cadence',
      manifest.productionBackupScheduleVerified === true && cadenceWithinRpo,
      cadenceValid
        ? `cadence=${cadenceMinutes}m; RPO target=${backupEvidence?.targets?.rpoMinutes ?? 'missing'}m`
        : 'productionBackupCadenceMinutes must be a positive integer',
    ),
  );

  const encryptedStorageSatisfied =
    manifest.liveOrProductionData !== true || backupEvidence?.dump?.encryptedStorageConfirmed === true;
  checks.push(
    check(
      'encrypted-storage',
      encryptedStorageSatisfied,
      manifest.liveOrProductionData === true
        ? 'live/production recovery evidence requires encrypted storage confirmation'
        : 'non-live controlled dataset does not require live-data storage confirmation',
    ),
  );

  checks.push(
    check(
      'isolated-restore-acknowledged',
      manifest.isolatedRestoreTargetVerified === true,
      'isolatedRestoreTargetVerified must be true',
    ),
  );
  checks.push(
    check(
      'retention-acknowledged',
      manifest.evidenceRetainedOutsideRestoreTarget === true,
      'evidenceRetainedOutsideRestoreTarget must be true',
    ),
  );

  const allPass = checks.every((entry) => entry.status === 'PASS');
  const core = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    releaseCommit: manifest.releaseCommit ?? null,
    status: allPass ? 'PASS' : 'FAIL',
    representativeRecoverySatisfied: allPass,
    liveMoneyApproved: false,
    checks,
    backupEvidence: {
      sha256: backupEvidenceSha256 ?? null,
      operator: backupEvidence?.operator ?? null,
      source: backupEvidence?.source ?? null,
      restoreTarget: backupEvidence?.restoreTarget ?? null,
      rpoMinutes: backupEvidence?.targets?.rpoMinutes ?? null,
      rtoMinutes: backupEvidence?.targets?.rtoMinutes ?? null,
      restoreDurationMs: backupEvidence?.restoreDurationMs ?? null,
      recoveryPointAgeAtRestoreStartMs:
        backupEvidence?.recoveryPointAgeAtRestoreStartMs ?? null,
      publicTableCount: backupEvidence?.publicTableCount ?? null,
      representativeData: backupEvidence?.representativeData ?? null,
    },
    operationalReview: {
      operator: manifest.operator ?? null,
      reviewer: manifest.reviewer ?? null,
      productionBackupCadenceMinutes: cadenceMinutes ?? null,
      productionBackupScheduleVerified: manifest.productionBackupScheduleVerified === true,
      liveOrProductionData: manifest.liveOrProductionData === true,
      isolatedRestoreTargetVerified: manifest.isolatedRestoreTargetVerified === true,
      evidenceRetainedOutsideRestoreTarget:
        manifest.evidenceRetainedOutsideRestoreTarget === true,
    },
    scope:
      'Representative exact-release backup/restore and operational recovery evidence. This report cannot approve live money or replace hardware/network, offline durability, payment, abuse or close/reconciliation gates.',
  };

  return { ...core, reportDigestSha256: digestObject(core) };
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(resolve(path), 'utf8'));
  } catch (error) {
    throw new Error(`unable to read ${label} JSON ${path}: ${error.message}`);
  }
}

function usage() {
  console.error(
    'Usage: node scripts/representative-recovery-evidence.mjs <manifest.json> [output.json]',
  );
}

async function main() {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    usage();
    process.exitCode = 2;
    return;
  }
  const manifest = readJson(manifestPath, 'representative recovery manifest');
  if (!nonEmpty(manifest.backupRestoreEvidencePath)) {
    throw new Error('backupRestoreEvidencePath is required');
  }
  const backupPath = resolve(dirname(resolve(manifestPath)), manifest.backupRestoreEvidencePath);
  const backupBytes = readFileSync(backupPath);
  const backupEvidence = JSON.parse(backupBytes.toString('utf8'));
  const report = verifyRepresentativeRecoveryFieldEvidence({
    manifest,
    backupEvidence,
    backupEvidenceSha256: digestBytes(backupBytes),
  });

  const outputPath = resolve(
    process.argv[3] ?? 'artifacts/pilot/representative-recovery-field-evidence.json',
  );
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(
    `Representative recovery field evidence ${report.status}: ${outputPath} digest=${report.reportDigestSha256}`,
  );
  if (report.status !== 'PASS') process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
