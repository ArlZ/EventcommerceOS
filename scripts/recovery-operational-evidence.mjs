import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RELEASE_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const DATA_CLASSES = new Set(['REPRESENTATIVE_RELEASE', 'LIVE']);

function check(id, passed, details) {
  return { id, status: passed ? 'PASS' : 'FAIL', details };
}

function nonEmpty(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

function validTime(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(resolve(path), 'utf8'));
  } catch (error) {
    throw new Error(`unable to read ${label} JSON ${path}: ${error.message}`);
  }
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

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function allRepresentativeDomainsPresent(value) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0 &&
    Object.values(value).every((entry) => entry === true)
  );
}

function databaseIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const host = typeof value.host === 'string' ? value.host.trim().toLowerCase() : '';
  const port = Number(value.port);
  const database = typeof value.database === 'string' ? value.database.trim() : '';
  if (!host || !Number.isSafeInteger(port) || port <= 0 || !database) return null;
  return `${host}:${port}/${database}`;
}

function validateRestoreEvidence(evidence, releaseCommit, policy, dataClass) {
  const checks = [];
  const expectedRpo = policy.rpoMinutes;
  const expectedRto = policy.rtoMinutes;
  checks.push(
    check(
      'restore:pass',
      evidence?.schemaVersion === 2 && evidence?.result === 'PASS',
      `schema=${evidence?.schemaVersion ?? 'missing'}; result=${evidence?.result ?? 'missing'}`,
    ),
  );
  checks.push(
    check(
      'restore:release-identity',
      evidence?.releaseCommitSha === releaseCommit,
      `restore release=${evidence?.releaseCommitSha ?? 'missing'}`,
    ),
  );
  checks.push(
    check(
      'restore:named-operator',
      typeof evidence?.operator === 'string' && evidence.operator.trim().length > 0,
      `operator=${evidence?.operator ? 'present' : 'missing'}`,
    ),
  );
  const source = databaseIdentity(evidence?.source);
  const target = databaseIdentity(evidence?.restoreTarget);
  checks.push(
    check(
      'restore:isolated-target',
      Boolean(source && target && source !== target),
      `source=${source ?? 'invalid'}; restore=${target ?? 'invalid'}`,
    ),
  );
  checks.push(
    check(
      'restore:representative-data',
      allRepresentativeDomainsPresent(evidence?.representativeData),
      `representative domains=${Object.keys(evidence?.representativeData ?? {}).length}`,
    ),
  );
  checks.push(
    check(
      'restore:table-fingerprints',
      Number.isSafeInteger(evidence?.publicTableCount) &&
        evidence.publicTableCount > 0 &&
        Array.isArray(evidence?.tableFingerprints) &&
        evidence.tableFingerprints.length === evidence.publicTableCount,
      `publicTableCount=${evidence?.publicTableCount ?? 'invalid'}; fingerprints=${Array.isArray(evidence?.tableFingerprints) ? evidence.tableFingerprints.length : 'invalid'}`,
    ),
  );
  checks.push(
    check(
      'restore:archive-checksum',
      SHA256_PATTERN.test(evidence?.dump?.sha256 ?? '') &&
        Number.isSafeInteger(evidence?.dump?.bytes) &&
        evidence.dump.bytes > 0 &&
        evidence?.dump?.archiveListValidated === true,
      `sha256=${SHA256_PATTERN.test(evidence?.dump?.sha256 ?? '') ? 'valid' : 'invalid'}; bytes=${evidence?.dump?.bytes ?? 'invalid'}; archiveListValidated=${String(evidence?.dump?.archiveListValidated)}`,
    ),
  );
  checks.push(
    check(
      'restore:rpo-policy-match',
      evidence?.targets?.rpoMinutes === expectedRpo &&
        evidence?.targets?.drillRecoveryPointWithinRpoTarget === true,
      `drill target=${evidence?.targets?.rpoMinutes ?? 'missing'}; expected=${expectedRpo}; drillPass=${String(evidence?.targets?.drillRecoveryPointWithinRpoTarget)}`,
    ),
  );
  checks.push(
    check(
      'restore:rto-policy-match',
      evidence?.targets?.rtoMinutes === expectedRto &&
        evidence?.targets?.restoreWithinRtoTarget === true &&
        Number.isSafeInteger(evidence?.restoreDurationMs) &&
        evidence.restoreDurationMs <= expectedRto * 60_000,
      `drill target=${evidence?.targets?.rtoMinutes ?? 'missing'}; expected=${expectedRto}; restoreMs=${evidence?.restoreDurationMs ?? 'invalid'}`,
    ),
  );
  if (dataClass === 'LIVE') {
    checks.push(
      check(
        'restore:live-encryption',
        evidence?.dump?.encryptedStorageConfirmed === true,
        `encryptedStorageConfirmed=${String(evidence?.dump?.encryptedStorageConfirmed)}`,
      ),
    );
  }
  return checks;
}

function validateBackupRecord(record, index, policy) {
  const label = `backupRecords[${index}]`;
  const errors = [];
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return [`${label} must be an object`];
  }
  if (!validTime(record.snapshotAt)) errors.push(`${label}.snapshotAt must be an ISO timestamp`);
  if (!validTime(record.completedAt)) errors.push(`${label}.completedAt must be an ISO timestamp`);
  if (validTime(record.snapshotAt) && validTime(record.completedAt)) {
    if (Date.parse(record.completedAt) < Date.parse(record.snapshotAt)) {
      errors.push(`${label}.completedAt must not precede snapshotAt`);
    }
  }
  if (!SHA256_PATTERN.test(record.sha256 ?? '')) errors.push(`${label}.sha256 must be lowercase SHA-256`);
  if (!Number.isSafeInteger(record.bytes) || record.bytes <= 0) {
    errors.push(`${label}.bytes must be a positive safe integer`);
  }
  if (typeof record.sourceEvidenceRef !== 'string' || !record.sourceEvidenceRef.trim()) {
    errors.push(`${label}.sourceEvidenceRef is required`);
  }
  if (!Array.isArray(record.copies) || record.copies.length < 2) {
    errors.push(`${label}.copies must include at least primary and separate-failure-domain copies`);
    return errors;
  }
  const primaryFailureDomain = nonEmpty(policy.primaryFailureDomain, 'policy.primaryFailureDomain');
  const domains = new Set();
  let hasPrimary = false;
  let hasSecondary = false;
  for (const [copyIndex, copy] of record.copies.entries()) {
    const copyLabel = `${label}.copies[${copyIndex}]`;
    if (!copy || typeof copy !== 'object' || Array.isArray(copy)) {
      errors.push(`${copyLabel} must be an object`);
      continue;
    }
    const failureDomain = typeof copy.failureDomain === 'string' ? copy.failureDomain.trim() : '';
    if (!failureDomain) errors.push(`${copyLabel}.failureDomain is required`);
    else domains.add(failureDomain);
    if (failureDomain === primaryFailureDomain) hasPrimary = true;
    if (failureDomain && failureDomain !== primaryFailureDomain) hasSecondary = true;
    if (copy.encryptedAtRest !== true) errors.push(`${copyLabel}.encryptedAtRest must be true`);
    if (copy.checksumVerified !== true) errors.push(`${copyLabel}.checksumVerified must be true`);
    if (copy.sha256 !== record.sha256) errors.push(`${copyLabel}.sha256 must equal the backup SHA-256`);
    if (!validTime(copy.retainedThrough)) errors.push(`${copyLabel}.retainedThrough must be an ISO timestamp`);
    else if (Date.parse(copy.retainedThrough) < Date.parse(record.completedAt) + policy.retentionDays * 86_400_000) {
      errors.push(`${copyLabel}.retainedThrough does not satisfy ${policy.retentionDays}-day retention`);
    }
  }
  if (!hasPrimary) errors.push(`${label} has no copy in primary failure domain ${primaryFailureDomain}`);
  if (!hasSecondary || domains.size < 2) errors.push(`${label} has no independently retained copy in another failure domain`);
  return errors;
}

export function verifyOperationalRecoveryEvidence({ manifest, restoreEvidence, now = new Date() }) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('operational recovery manifest must be a JSON object');
  }
  if (manifest.schemaVersion !== 1) throw new Error('manifest.schemaVersion must equal 1');
  const releaseCommit = nonEmpty(manifest.releaseCommit, 'manifest.releaseCommit');
  if (!RELEASE_PATTERN.test(releaseCommit)) {
    throw new Error('manifest.releaseCommit must be a lowercase 40-character Git SHA');
  }
  const dataClass = nonEmpty(manifest.dataClass, 'manifest.dataClass');
  if (!DATA_CLASSES.has(dataClass)) {
    throw new Error('manifest.dataClass must be REPRESENTATIVE_RELEASE or LIVE');
  }
  const policy = manifest.policy;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    throw new Error('manifest.policy must be an object');
  }
  const normalizedPolicy = {
    rpoMinutes: positiveInteger(policy.rpoMinutes, 'policy.rpoMinutes'),
    rtoMinutes: positiveInteger(policy.rtoMinutes, 'policy.rtoMinutes'),
    cadenceMinutes: positiveInteger(policy.cadenceMinutes, 'policy.cadenceMinutes'),
    retentionDays: positiveInteger(policy.retentionDays, 'policy.retentionDays'),
    primaryFailureDomain: nonEmpty(policy.primaryFailureDomain, 'policy.primaryFailureDomain'),
  };
  const observationEndedAt = nonEmpty(manifest.observationEndedAt, 'manifest.observationEndedAt');
  if (!validTime(observationEndedAt)) throw new Error('manifest.observationEndedAt must be an ISO timestamp');
  const observationEndMs = Date.parse(observationEndedAt);
  if (observationEndMs > now.getTime() + 5 * 60_000) {
    throw new Error('manifest.observationEndedAt must not be materially in the future');
  }

  const checks = validateRestoreEvidence(
    restoreEvidence,
    releaseCommit,
    normalizedPolicy,
    dataClass,
  );
  checks.push(
    check(
      'cadence:declared-policy-within-rpo',
      normalizedPolicy.cadenceMinutes <= normalizedPolicy.rpoMinutes,
      `cadence=${normalizedPolicy.cadenceMinutes}m; RPO=${normalizedPolicy.rpoMinutes}m`,
    ),
  );

  const records = Array.isArray(manifest.backupRecords) ? [...manifest.backupRecords] : [];
  records.sort((left, right) => Date.parse(left?.snapshotAt ?? '') - Date.parse(right?.snapshotAt ?? ''));
  let recordsValid = records.length >= 3;
  const recordErrors = [];
  for (const [index, record] of records.entries()) {
    const errors = validateBackupRecord(record, index, normalizedPolicy);
    if (errors.length) recordsValid = false;
    recordErrors.push(...errors);
  }
  checks.push(
    check(
      'cadence:record-integrity',
      recordsValid,
      records.length < 3
        ? `backupRecords=${records.length}; require>=3`
        : recordErrors.length
          ? recordErrors.join('; ')
          : `backupRecords=${records.length}; all records/copies valid`,
    ),
  );

  let maximumGapMs = null;
  let latestAgeMs = null;
  let observationSpanMs = null;
  if (recordsValid) {
    const snapshots = records.map((record) => Date.parse(record.snapshotAt));
    const gaps = snapshots.slice(1).map((value, index) => value - snapshots[index]);
    maximumGapMs = gaps.length ? Math.max(...gaps) : 0;
    latestAgeMs = observationEndMs - snapshots.at(-1);
    observationSpanMs = observationEndMs - snapshots[0];
    const cadenceTargetMs = normalizedPolicy.cadenceMinutes * 60_000;
    const rpoTargetMs = normalizedPolicy.rpoMinutes * 60_000;
    checks.push(
      check(
        'cadence:observed-gap',
        gaps.every((gap) => gap >= 0 && gap <= cadenceTargetMs),
        `maximumGapMs=${maximumGapMs}; cadenceTargetMs=${cadenceTargetMs}`,
      ),
    );
    checks.push(
      check(
        'cadence:latest-recovery-point-age',
        latestAgeMs >= 0 && latestAgeMs <= rpoTargetMs,
        `latestRecoveryPointAgeMs=${latestAgeMs}; rpoTargetMs=${rpoTargetMs}`,
      ),
    );
    checks.push(
      check(
        'cadence:observation-window',
        observationSpanMs >= Math.max(cadenceTargetMs * 2, rpoTargetMs),
        `observationSpanMs=${observationSpanMs}; required>=${Math.max(cadenceTargetMs * 2, rpoTargetMs)}`,
      ),
    );
  }

  const operationalRecoverySatisfied = checks.every((entry) => entry.status === 'PASS');
  const core = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    releaseCommit,
    dataClass,
    observationEndedAt,
    policy: normalizedPolicy,
    backupRecordCount: records.length,
    maximumObservedBackupGapMs: maximumGapMs,
    latestRecoveryPointAgeMs: latestAgeMs,
    observationSpanMs,
    status: operationalRecoverySatisfied ? 'PASS' : 'FAIL',
    operationalRecoverySatisfied,
    checks,
    humanReviewRequired: true,
    scope:
      'Combines an exact-release representative backup/restore PASS with observed backup cadence, recovery-point age, retention, encryption, checksum verification and a separate failure-domain copy.',
    liveMoneyApproved: false,
  };
  return { ...core, reportDigestSha256: digest(core) };
}

function usage() {
  console.error(
    'Usage: node scripts/recovery-operational-evidence.mjs <manifest.json> [output.json]',
  );
}

async function main() {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    usage();
    process.exitCode = 2;
    return;
  }
  const absoluteManifest = resolve(manifestPath);
  const manifest = readJson(absoluteManifest, 'operational recovery manifest');
  const restorePath = nonEmpty(manifest.restoreEvidence, 'manifest.restoreEvidence');
  const restoreEvidence = readJson(
    resolve(dirname(absoluteManifest), restorePath),
    'backup/restore evidence',
  );
  const report = verifyOperationalRecoveryEvidence({ manifest, restoreEvidence });
  const outputPath = resolve(
    process.argv[3] ?? 'artifacts/pilot/recovery-operational-evidence.json',
  );
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(
    `Operational recovery evidence ${report.status}: ${outputPath} digest=${report.reportDigestSha256}`,
  );
  if (report.status !== 'PASS') process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
