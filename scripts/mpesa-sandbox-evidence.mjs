import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const STATUS = new Set(['NOT_RUN', 'PASS', 'FAIL']);
const TERMINAL_STATES = new Set(['SUCCEEDED', 'FAILED']);
const TRUTH_SOURCES = new Set(['PROVIDER_QUERY', 'PROVIDER_RECONCILIATION']);
const SENSITIVE_KEY = /(phone|msisdn|passkey|secret|token|authorization|credential|password)/i;
export const MPESA_SCENARIO_IDS = [
  'MPESA-01',
  'MPESA-02',
  'MPESA-03',
  'MPESA-04',
  'MPESA-05',
  'MPESA-06',
  'MPESA-07',
  'MPESA-08',
];
function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
function validTime(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
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
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}
function check(id, passed, details) {
  return { id, status: passed ? 'PASS' : 'FAIL', details };
}
function sensitivePaths(value, path = 'matrix') {
  if (!value || typeof value !== 'object') return [];
  const findings = [];
  for (const [key, nested] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;
    if (SENSITIVE_KEY.test(key)) findings.push(nextPath);
    if (nested && typeof nested === 'object') findings.push(...sensitivePaths(nested, nextPath));
  }
  return findings;
}
function integerAtLeast(value, minimum) {
  return Number.isSafeInteger(value) && value >= minimum;
}
function validateScenarioCommon(scenario, id) {
  const errors = [];
  if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario)) {
    return [`${id} must be an object`];
  }
  if (scenario.id !== id) errors.push(`${id}.id must equal ${id}`);
  if (!STATUS.has(scenario.status)) {
    errors.push(`${id}.status must be NOT_RUN, PASS or FAIL`);
    return errors;
  }
  if (scenario.status !== 'PASS') return errors;
  if (!validTime(scenario.startedAt) || !validTime(scenario.completedAt)) {
    errors.push(`${id} PASS requires valid startedAt/completedAt timestamps`);
  } else if (Date.parse(scenario.completedAt) < Date.parse(scenario.startedAt)) {
    errors.push(`${id}.completedAt must not precede startedAt`);
  }
  if (!nonEmpty(scenario.attemptId)) errors.push(`${id} PASS requires attemptId`);
  if (
    !scenario.evidence ||
    typeof scenario.evidence !== 'object' ||
    Array.isArray(scenario.evidence)
  ) {
    errors.push(`${id} PASS requires an evidence object`);
  } else if (scenario.evidence.duplicateBusinessEffectCount !== 0) {
    errors.push(`${id} PASS requires duplicateBusinessEffectCount=0`);
  }
  return errors;
}
function validateScenarioSpecific(scenario) {
  if (scenario.status !== 'PASS' || !scenario.evidence || typeof scenario.evidence !== 'object') {
    return [];
  }
  const e = scenario.evidence;
  const errors = [];
  switch (scenario.id) {
    case 'MPESA-01':
      if (e.finalState !== 'SUCCEEDED') errors.push('MPESA-01 finalState must be SUCCEEDED');
      if (e.paymentAttemptCount !== 1) errors.push('MPESA-01 paymentAttemptCount must equal 1');
      if (e.reconciliationOutstanding !== false) {
        errors.push('MPESA-01 reconciliationOutstanding must be false');
      }
      break;
    case 'MPESA-02':
      if (e.finalState !== 'FAILED') errors.push('MPESA-02 finalState must be FAILED');
      if (!TRUTH_SOURCES.has(e.truthSource)) {
        errors.push('MPESA-02 truthSource must be PROVIDER_QUERY or PROVIDER_RECONCILIATION');
      }
      break;
    case 'MPESA-03':
      if (e.initiationTransportUncertaintyObserved !== true) {
        errors.push('MPESA-03 initiationTransportUncertaintyObserved must be true');
      }
      if (e.uncertainStateObserved !== 'UNKNOWN') {
        errors.push('MPESA-03 uncertainStateObserved must equal UNKNOWN');
      }
      if (e.paymentAttemptCount !== 1) errors.push('MPESA-03 paymentAttemptCount must equal 1');
      break;
    case 'MPESA-04':
      if (e.queryTransportFailureObserved !== true) {
        errors.push('MPESA-04 queryTransportFailureObserved must be true');
      }
      if (e.uncertainStateObserved !== 'UNKNOWN') {
        errors.push('MPESA-04 uncertainStateObserved must equal UNKNOWN');
      }
      break;
    case 'MPESA-05':
      if (e.replayedSameIdempotencyKey !== true) {
        errors.push('MPESA-05 replayedSameIdempotencyKey must be true');
      }
      if (e.paymentAttemptCount !== 1) errors.push('MPESA-05 paymentAttemptCount must equal 1');
      if (e.providerInitiationCount !== 1) {
        errors.push('MPESA-05 providerInitiationCount must equal 1');
      }
      break;
    case 'MPESA-06':
      if (!integerAtLeast(e.duplicateCallbackCount, 1)) {
        errors.push('MPESA-06 duplicateCallbackCount must be at least 1');
      }
      if (e.duplicateDeliveryClassified !== true) {
        errors.push('MPESA-06 duplicateDeliveryClassified must be true');
      }
      break;
    case 'MPESA-07':
      if (e.callbackBeforeQueryObserved !== true || e.queryBeforeCallbackObserved !== true) {
        errors.push(
          'MPESA-07 must observe callback-before-query and query-before-callback ordering',
        );
      }
      if (e.terminalStateRegressed !== false) {
        errors.push('MPESA-07 terminalStateRegressed must be false');
      }
      if (e.finalState !== undefined && !TERMINAL_STATES.has(e.finalState)) {
        errors.push('MPESA-07 finalState, when provided, must be SUCCEEDED or FAILED');
      }
      break;
    case 'MPESA-08':
      if (e.malformedCallbackRejected !== true) {
        errors.push('MPESA-08 malformedCallbackRejected must be true');
      }
      if (e.financialTruthChanged !== false) {
        errors.push('MPESA-08 financialTruthChanged must be false');
      }
      break;
    default:
      errors.push(`unexpected scenario ${scenario.id}`);
  }
  return errors;
}
export function verifyMpesaSandboxFaultMatrix(matrix, now = new Date()) {
  if (!matrix || typeof matrix !== 'object' || Array.isArray(matrix)) {
    throw new Error('M-PESA sandbox matrix must be a JSON object');
  }
  const checks = [];
  checks.push(check('schema', matrix.schemaVersion === 1, 'schemaVersion must equal 1'));
  checks.push(
    check(
      'release',
      SHA_PATTERN.test(matrix.releaseCommit ?? ''),
      'releaseCommit must be a lowercase 40-character Git SHA',
    ),
  );
  checks.push(check('event', nonEmpty(matrix.eventId), 'eventId is required'));
  checks.push(check('provider', matrix.provider === 'mpesa', 'provider must equal mpesa'));
  checks.push(
    check('environment', matrix.environment === 'sandbox', 'environment must equal sandbox'),
  );
  checks.push(
    check(
      'live-money-boundary',
      matrix.liveMoneyApproved === false,
      'liveMoneyApproved must be explicitly false',
    ),
  );
  checks.push(check('operator', nonEmpty(matrix.operator), 'operator is required'));
  const sensitive = sensitivePaths(matrix);
  checks.push(
    check(
      'secret-and-phone-hygiene',
      sensitive.length === 0,
      sensitive.length === 0
        ? 'no sensitive key names are retained'
        : `remove sensitive fields: ${sensitive.join(', ')}`,
    ),
  );
  const scenarios = Array.isArray(matrix.scenarios) ? matrix.scenarios : [];
  const byId = new Map();
  const duplicates = [];
  for (const scenario of scenarios) {
    const id = scenario?.id;
    if (!nonEmpty(id)) continue;
    if (byId.has(id)) duplicates.push(id);
    byId.set(id, scenario);
  }
  const unexpected = [...byId.keys()].filter((id) => !MPESA_SCENARIO_IDS.includes(id));
  checks.push(
    check(
      'scenario-set',
      scenarios.length === MPESA_SCENARIO_IDS.length &&
        duplicates.length === 0 &&
        unexpected.length === 0 &&
        MPESA_SCENARIO_IDS.every((id) => byId.has(id)),
      `expected exactly ${MPESA_SCENARIO_IDS.join(', ')}`,
    ),
  );
  for (const id of MPESA_SCENARIO_IDS) {
    const scenario = byId.get(id);
    const errors = [
      ...validateScenarioCommon(scenario, id),
      ...(scenario ? validateScenarioSpecific(scenario) : []),
    ];
    checks.push(
      check(
        `scenario:${id}`,
        errors.length === 0 && scenario?.status === 'PASS',
        errors.length
          ? errors.join('; ')
          : scenario?.status === 'PASS'
            ? 'scenario evidence satisfies the fail-closed matrix checks'
            : `scenario status is ${scenario?.status ?? 'missing'}; PASS is required`,
      ),
    );
  }
  const allPass = checks.every((entry) => entry.status === 'PASS');
  const core = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    releaseCommit: matrix.releaseCommit ?? null,
    eventId: matrix.eventId ?? null,
    provider: 'mpesa',
    environment: 'sandbox',
    status: allPass ? 'PASS' : 'FAIL',
    paymentFaultMatrixSatisfied: allPass,
    liveMoneyApproved: false,
    checks,
    scenarioSummary: MPESA_SCENARIO_IDS.map((id) => ({
      id,
      status: byId.get(id)?.status ?? 'MISSING',
    })),
    scope:
      'Controlled Daraja sandbox evidence only. This report cannot approve production credentials or live money.',
  };
  return { ...core, reportDigestSha256: digest(core) };
}
function readJson(path) {
  try {
    return JSON.parse(readFileSync(resolve(path), 'utf8'));
  } catch (error) {
    throw new Error(`unable to read M-PESA matrix JSON ${path}: ${error.message}`);
  }
}
function usage() {
  console.error('Usage: node scripts/mpesa-sandbox-evidence.mjs <matrix.json> [output.json]');
}
async function main() {
  const input = process.argv[2];
  if (!input) {
    usage();
    process.exitCode = 2;
    return;
  }
  const report = verifyMpesaSandboxFaultMatrix(readJson(input));
  const output = resolve(process.argv[3] ?? 'artifacts/pilot/mpesa-sandbox-fault-matrix.json');
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\\n`, { mode: 0o600 });
  console.log(
    `M-PESA sandbox fault matrix ${report.status}: ${output} digest=${report.reportDigestSha256}`,
  );
  if (report.status !== 'PASS') process.exitCode = 1;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
