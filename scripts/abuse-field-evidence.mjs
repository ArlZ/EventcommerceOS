import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA_PATTERN = /^[0-9a-f]{40}$/;

function nonEmpty(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(resolve(path), 'utf8'));
  } catch (error) {
    throw new Error(`unable to read ${label} JSON ${path}: ${error.message}`);
  }
}

function check(id, passed, details) {
  return { id, status: passed ? 'PASS' : 'FAIL', details };
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

function validTime(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function overlaps(left, right) {
  if (![left.startedAt, left.completedAt, right.startedAt, right.completedAt].every(validTime)) {
    return false;
  }
  return Date.parse(left.startedAt) <= Date.parse(right.completedAt) && Date.parse(right.startedAt) <= Date.parse(left.completedAt);
}

function validateObservation(observation, label, releaseCommit, expectedRole) {
  const errors = [];
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) {
    return [`${label} must be a JSON object`];
  }
  if (observation.schemaVersion !== 1) errors.push(`${label}.schemaVersion must equal 1`);
  if (observation.releaseCommit !== releaseCommit) {
    errors.push(`${label}.releaseCommit must equal ${releaseCommit}`);
  }
  if (observation.targetRole !== expectedRole) {
    errors.push(`${label}.targetRole must equal ${expectedRole}`);
  }
  if (!validTime(observation.startedAt) || !validTime(observation.completedAt)) {
    errors.push(`${label} must contain valid startedAt/completedAt timestamps`);
  }
  for (const field of ['requestCount', 'successCount', 'rateLimitedCount', 'transportErrorCount']) {
    if (!Number.isSafeInteger(observation[field]) || observation[field] < 0) {
      errors.push(`${label}.${field} must be a non-negative safe integer`);
    }
  }
  if (!Array.isArray(observation.observedRateLimitPolicies)) {
    errors.push(`${label}.observedRateLimitPolicies must be an array`);
  }
  if (!Array.isArray(observation.observedConcurrencyLimits)) {
    errors.push(`${label}.observedConcurrencyLimits must be an array`);
  }
  if (!Array.isArray(observation.observedAuthConcurrencyLimits)) {
    errors.push(`${label}.observedAuthConcurrencyLimits must be an array`);
  }
  return errors;
}

function recovered(observation) {
  return observation.recovery?.attempted === true &&
    Number.isSafeInteger(observation.recovery.status) &&
    observation.recovery.status >= 200 &&
    observation.recovery.status < 300;
}

function expectedPolicy(observation, policy) {
  return Array.isArray(observation.observedRateLimitPolicies) &&
    observation.observedRateLimitPolicies.includes(policy);
}

export function verifyAbuseFieldEvidence({
  manifest,
  cloudPublicBurst,
  cloudConcurrency,
  operatorReadBurst,
  edgeRunaway,
  edgeHealthyPeer,
  providerCallbackBurst,
  paymentFaultMatrixReport,
  now = new Date(),
}) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('abuse evidence manifest must be a JSON object');
  }
  if (manifest.schemaVersion !== 1) throw new Error('manifest.schemaVersion must equal 1');
  const releaseCommit = nonEmpty(manifest.releaseCommit, 'manifest.releaseCommit');
  if (!SHA_PATTERN.test(releaseCommit)) {
    throw new Error('manifest.releaseCommit must be a lowercase 40-character Git SHA');
  }
  const eventId = nonEmpty(manifest.eventId, 'manifest.eventId');

  const checks = [];
  const observations = [
    ['cloudPublicBurst', cloudPublicBurst, 'CLOUD_PUBLIC'],
    ['cloudConcurrency', cloudConcurrency, 'CLOUD_CONCURRENCY'],
    ['operatorReadBurst', operatorReadBurst, 'CLOUD_OPERATOR_READ'],
    ['edgeRunaway', edgeRunaway, 'EDGE_DEVICE_SYNC'],
    ['edgeHealthyPeer', edgeHealthyPeer, 'EDGE_DEVICE_SYNC'],
    ['providerCallbackBurst', providerCallbackBurst, 'PROVIDER_CALLBACK'],
  ];
  let observationsValid = true;
  for (const [label, observation, expectedRole] of observations) {
    const errors = validateObservation(observation, label, releaseCommit, expectedRole);
    if (errors.length) observationsValid = false;
    checks.push(
      check(
        `observation:${label}:schema`,
        errors.length === 0,
        errors.length ? errors.join('; ') : 'schema, release and target role are valid',
      ),
    );
  }

  if (observationsValid) {
    checks.push(
      check(
        'cloud:public-rate-limit-engaged',
        cloudPublicBurst.rateLimitedCount > 0 && expectedPolicy(cloudPublicBurst, 'PUBLIC'),
        `429=${cloudPublicBurst.rateLimitedCount}; policies=${cloudPublicBurst.observedRateLimitPolicies.join(',') || 'none'}`,
      ),
    );
    checks.push(
      check(
        'cloud:public-recovers',
        recovered(cloudPublicBurst),
        `recovery=${cloudPublicBurst.recovery?.status ?? cloudPublicBurst.recovery?.errorCode ?? 'missing'}`,
      ),
    );
    const concurrencyEvidence = [
      ...cloudConcurrency.observedConcurrencyLimits,
      ...cloudConcurrency.observedAuthConcurrencyLimits,
    ];
    checks.push(
      check(
        'cloud:concurrency-limit-engaged',
        cloudConcurrency.rateLimitedCount > 0 && concurrencyEvidence.length > 0,
        `429=${cloudConcurrency.rateLimitedCount}; concurrencyLimits=${concurrencyEvidence.join(',') || 'none'}`,
      ),
    );
    checks.push(
      check(
        'cloud:concurrency-recovers',
        recovered(cloudConcurrency),
        `recovery=${cloudConcurrency.recovery?.status ?? cloudConcurrency.recovery?.errorCode ?? 'missing'}`,
      ),
    );
    checks.push(
      check(
        'cloud:operator-rate-limit-engaged',
        operatorReadBurst.rateLimitedCount > 0 && expectedPolicy(operatorReadBurst, 'OPERATOR_READ'),
        `429=${operatorReadBurst.rateLimitedCount}; policies=${operatorReadBurst.observedRateLimitPolicies.join(',') || 'none'}`,
      ),
    );
    checks.push(
      check(
        'cloud:operator-recovers',
        recovered(operatorReadBurst),
        `recovery=${operatorReadBurst.recovery?.status ?? operatorReadBurst.recovery?.errorCode ?? 'missing'}`,
      ),
    );
    checks.push(
      check(
        'edge:runaway-device-throttled',
        edgeRunaway.rateLimitedCount > 0 && expectedPolicy(edgeRunaway, 'DEVICE_SYNC'),
        `429=${edgeRunaway.rateLimitedCount}; policies=${edgeRunaway.observedRateLimitPolicies.join(',') || 'none'}`,
      ),
    );
    checks.push(
      check(
        'edge:runaway-device-recovers',
        recovered(edgeRunaway),
        `recovery=${edgeRunaway.recovery?.status ?? edgeRunaway.recovery?.errorCode ?? 'missing'}`,
      ),
    );
    checks.push(
      check(
        'edge:healthy-peer-continues',
        edgeHealthyPeer.successCount > 0 && edgeHealthyPeer.rateLimitedCount === 0,
        `2xx=${edgeHealthyPeer.successCount}; 429=${edgeHealthyPeer.rateLimitedCount}`,
      ),
    );
    checks.push(
      check(
        'edge:peer-overlaps-runaway',
        overlaps(edgeRunaway, edgeHealthyPeer),
        `${edgeRunaway.startedAt}..${edgeRunaway.completedAt} vs ${edgeHealthyPeer.startedAt}..${edgeHealthyPeer.completedAt}`,
      ),
    );
    checks.push(
      check(
        'offline-boundary:edge-peer-overlaps-cloud-flood',
        overlaps(cloudPublicBurst, edgeHealthyPeer),
        `${cloudPublicBurst.startedAt}..${cloudPublicBurst.completedAt} vs ${edgeHealthyPeer.startedAt}..${edgeHealthyPeer.completedAt}`,
      ),
    );
    checks.push(
      check(
        'provider:callback-throttle-engaged',
        providerCallbackBurst.rateLimitedCount > 0 &&
          expectedPolicy(providerCallbackBurst, 'PROVIDER_CALLBACK'),
        `429=${providerCallbackBurst.rateLimitedCount}; policies=${providerCallbackBurst.observedRateLimitPolicies.join(',') || 'none'}`,
      ),
    );
    checks.push(
      check(
        'provider:callback-recovers',
        recovered(providerCallbackBurst),
        `recovery=${providerCallbackBurst.recovery?.status ?? providerCallbackBurst.recovery?.errorCode ?? 'missing'}`,
      ),
    );
  }

  const paymentReportValid =
    paymentFaultMatrixReport &&
    typeof paymentFaultMatrixReport === 'object' &&
    !Array.isArray(paymentFaultMatrixReport) &&
    paymentFaultMatrixReport.releaseCommit === releaseCommit &&
    paymentFaultMatrixReport.eventId === eventId;
  checks.push(
    check(
      'payment:fault-matrix-identity',
      Boolean(paymentReportValid),
      paymentReportValid
        ? 'payment fault report matches exact release and event'
        : 'payment fault report is missing or release/event identity differs',
    ),
  );
  checks.push(
    check(
      'payment:throttling-preserves-truth',
      Boolean(paymentReportValid && paymentFaultMatrixReport.status === 'PASS'),
      `payment fault matrix status=${paymentFaultMatrixReport?.status ?? 'missing'}`,
    ),
  );

  const abuseGateSatisfied = checks.every((entry) => entry.status === 'PASS');
  const core = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    releaseCommit,
    eventId,
    status: abuseGateSatisfied ? 'PASS' : 'FAIL',
    abuseGateSatisfied,
    checks,
    scope:
      'Controlled-pilot HTTP abuse/flood evidence: Cloud rate/concurrency recovery, Event Edge peer isolation during runaway traffic and Cloud flood, provider callback throttling, plus independent payment fault-matrix truth preservation.',
    liveMoneyApproved: false,
  };
  return { ...core, reportDigestSha256: digest(core) };
}

function usage() {
  console.error('Usage: node scripts/abuse-field-evidence.mjs <manifest.json> [output.json]');
}

async function main() {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    usage();
    process.exitCode = 2;
    return;
  }
  const manifest = readJson(manifestPath, 'abuse evidence manifest');
  const manifestDir = dirname(resolve(manifestPath));
  const paths = [
    'cloudPublicBurst',
    'cloudConcurrency',
    'operatorReadBurst',
    'edgeRunaway',
    'edgeHealthyPeer',
    'providerCallbackBurst',
    'paymentFaultMatrixReport',
  ];
  for (const field of paths) nonEmpty(manifest[field], `manifest.${field}`);
  const report = verifyAbuseFieldEvidence({
    manifest,
    cloudPublicBurst: readJson(resolve(manifestDir, manifest.cloudPublicBurst), 'cloudPublicBurst'),
    cloudConcurrency: readJson(resolve(manifestDir, manifest.cloudConcurrency), 'cloudConcurrency'),
    operatorReadBurst: readJson(resolve(manifestDir, manifest.operatorReadBurst), 'operatorReadBurst'),
    edgeRunaway: readJson(resolve(manifestDir, manifest.edgeRunaway), 'edgeRunaway'),
    edgeHealthyPeer: readJson(resolve(manifestDir, manifest.edgeHealthyPeer), 'edgeHealthyPeer'),
    providerCallbackBurst: readJson(
      resolve(manifestDir, manifest.providerCallbackBurst),
      'providerCallbackBurst',
    ),
    paymentFaultMatrixReport: readJson(
      resolve(manifestDir, manifest.paymentFaultMatrixReport),
      'paymentFaultMatrixReport',
    ),
  });
  const outputPath = resolve(process.argv[3] ?? 'artifacts/pilot/abuse-field-evidence.json');
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(
    `Abuse field evidence ${report.status}: ${outputPath} digest=${report.reportDigestSha256}`,
  );
  if (report.status !== 'PASS') process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
