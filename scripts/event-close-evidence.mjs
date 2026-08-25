import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const RELEASE_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function integerString(value, label) {
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) {
    throw new Error(`${label} must be an integer string`);
  }
  return BigInt(value);
}

function check(id, passed, details, gate) {
  return { id, gate, status: passed ? 'PASS' : 'FAIL', details };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function validateBaseUrl(value) {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('CLOUD_API_BASE_URL must use HTTPS unless it targets localhost');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url;
}

async function fetchJson(fetchImpl, url, token) {
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error(`request failed with HTTP ${response.status}`);
  return response.json();
}

async function fetchText(fetchImpl, url, token) {
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error(`request failed with HTTP ${response.status}`);
  return response.text();
}

export async function collectEventCloseEvidence({
  baseUrl,
  eventId,
  operatorBearer,
  expectedReleaseCommit,
  fetchImpl = fetch,
  now = new Date(),
}) {
  if (!RELEASE_PATTERN.test(expectedReleaseCommit ?? '')) {
    throw new Error('expectedReleaseCommit must be a lowercase 40-character Git SHA');
  }
  if (!nonEmptyString(eventId)) throw new Error('eventId is required');
  if (!nonEmptyString(operatorBearer)) throw new Error('operatorBearer is required');

  const base = validateBaseUrl(baseUrl);
  const api = (path) =>
    new URL(path.replace(/^\//, ''), `${base.toString().replace(/\/$/, '')}/`).toString();

  const runtimeHealth = await fetchJson(fetchImpl, api('/health'));
  if (runtimeHealth.releaseCommit !== expectedReleaseCommit) {
    throw new Error(
      `deployed Cloud release ${runtimeHealth.releaseCommit ?? '<missing>'} does not match expected ${expectedReleaseCommit}`,
    );
  }

  const encodedEventId = encodeURIComponent(eventId);
  const [liveReport, actions, storedReports] = await Promise.all([
    fetchJson(fetchImpl, api(`/event-close/events/${encodedEventId}/report`), operatorBearer),
    fetchJson(fetchImpl, api(`/event-close/events/${encodedEventId}/actions`), operatorBearer),
    fetchJson(fetchImpl, api(`/event-close/events/${encodedEventId}/reports`), operatorBearer),
  ]);

  let latestStoredCsv = null;
  if (Array.isArray(storedReports) && storedReports.length > 0) {
    const sorted = [...storedReports].sort((left, right) => left.revision - right.revision);
    const latest = sorted.at(-1);
    const csv = await fetchText(
      fetchImpl,
      api(`/event-close/events/${encodedEventId}/reports/${latest.revision}/export.csv`),
      operatorBearer,
    );
    latestStoredCsv = {
      revision: latest.revision,
      sha256: sha256(csv),
      byteLength: Buffer.byteLength(csv),
    };
  }

  return {
    schemaVersion: 1,
    releaseCommit: expectedReleaseCommit,
    collectedAt: now.toISOString(),
    eventId,
    runtimeHealth,
    liveReport,
    actions,
    storedReports,
    latestStoredCsv,
  };
}

function reportHash(report) {
  return sha256(JSON.stringify(report));
}

function eventMatches(report, eventId) {
  return report?.event?.eventId === eventId;
}

function paymentChecks(report, checks) {
  const gate = 'controlledPilotClose';
  const unresolved = Array.isArray(report.unresolvedPayments) ? report.unresolvedPayments : null;
  checks.push(
    check(
      'payments:unresolved-attempts',
      unresolved !== null && unresolved.length === 0,
      unresolved === null
        ? 'unresolvedPayments is not an array'
        : `unresolvedPayments=${unresolved.length}`,
      gate,
    ),
  );

  const methods = Array.isArray(report.paymentMethods) ? report.paymentMethods : [];
  const unresolvedMethodAttempts = methods.reduce(
    (sum, method) =>
      sum +
      (Number.isSafeInteger(method?.unresolvedAttemptCount) ? method.unresolvedAttemptCount : 1),
    0,
  );
  checks.push(
    check(
      'payments:method-certainty',
      Array.isArray(report.paymentMethods) && unresolvedMethodAttempts === 0,
      `paymentMethodUnresolvedAttempts=${unresolvedMethodAttempts}`,
      gate,
    ),
  );

  const providers = Array.isArray(report.providerReconciliation)
    ? report.providerReconciliation
    : [];
  const providerFailures = providers.filter(
    (provider) =>
      provider?.transactionReconciliationStatus !== 'RECONCILED' ||
      provider?.pendingCount !== 0 ||
      provider?.unknownCount !== 0 ||
      provider?.adjustmentUnknownCount !== 0,
  );
  checks.push(
    check(
      'payments:provider-reconciliation',
      Array.isArray(report.providerReconciliation) && providerFailures.length === 0,
      `providerReconciliationExceptions=${providerFailures.length}`,
      gate,
    ),
  );
}

function financialChecks(report, checks) {
  const gate = 'controlledPilotClose';
  const rows = Array.isArray(report.financialReconciliation) ? report.financialReconciliation : [];
  let invalid = 0;
  for (const row of rows) {
    try {
      if (
        row?.conclusive !== true ||
        integerString(row.salesToTenderVarianceMinor, 'variance') !== 0n
      ) {
        invalid += 1;
      }
    } catch {
      invalid += 1;
    }
  }
  checks.push(
    check(
      'financial:sales-to-tender',
      rows.length > 0 && invalid === 0,
      `rows=${rows.length}; nonConclusiveOrNonZeroVariance=${invalid}`,
      gate,
    ),
  );

  const deviceDrilldowns = Array.isArray(report.drilldowns)
    ? report.drilldowns.filter((row) => row?.dimensionType === 'DEVICE')
    : [];
  const closedTransactions = deviceDrilldowns.reduce(
    (sum, row) => sum + (Number.isSafeInteger(row?.transactionCount) ? row.transactionCount : 0),
    0,
  );
  checks.push(
    check(
      'financial:non-empty-pilot',
      closedTransactions > 0,
      `deviceClosedTransactions=${closedTransactions}`,
      gate,
    ),
  );
}

function cashChecks(report, checks) {
  const gate = 'controlledPilotClose';
  const scopes = Array.isArray(report.cash?.scopes) ? report.cash.scopes : [];
  let scopeFailures = 0;
  for (const scope of scopes) {
    try {
      if (
        scope?.declarationStatus !== 'DECLARED' ||
        scope.declaredMinor === null ||
        integerString(scope.varianceMinor, 'cash variance') !== 0n
      ) {
        scopeFailures += 1;
      }
    } catch {
      scopeFailures += 1;
    }
  }
  checks.push(
    check(
      'cash:scope-declarations',
      scopeFailures === 0,
      `cashScopes=${scopes.length}; missingOrNonZeroVariance=${scopeFailures}`,
      gate,
    ),
  );

  const summaries = Array.isArray(report.cash?.summary) ? report.cash.summary : [];
  let summaryFailures = 0;
  for (const summary of summaries) {
    try {
      if (
        summary?.declarationStatus !== 'COMPLETE' ||
        summary.declaredMinor === null ||
        integerString(summary.varianceMinor, 'cash summary variance') !== 0n
      ) {
        summaryFailures += 1;
      }
    } catch {
      summaryFailures += 1;
    }
  }
  checks.push(
    check(
      'cash:summary',
      summaryFailures === 0,
      `cashSummaryRows=${summaries.length}; incompleteOrNonZeroVariance=${summaryFailures}`,
      gate,
    ),
  );
}

function inventoryChecks(report, checks) {
  const gate = 'inventoryCloseReconciliation';
  const transfers = Array.isArray(report.openTransfers) ? report.openTransfers : null;
  checks.push(
    check(
      'inventory:open-transfers',
      transfers !== null && transfers.length === 0,
      transfers === null ? 'openTransfers is not an array' : `openTransfers=${transfers.length}`,
      gate,
    ),
  );

  const alerts = Array.isArray(report.unresolvedCriticalAlerts)
    ? report.unresolvedCriticalAlerts
    : null;
  checks.push(
    check(
      'inventory:critical-alerts',
      alerts !== null && alerts.length === 0,
      alerts === null
        ? 'unresolvedCriticalAlerts is not an array'
        : `unresolvedCriticalAlerts=${alerts.length}`,
      gate,
    ),
  );

  const variances = Array.isArray(report.inventoryVariances) ? report.inventoryVariances : [];
  let unclosedCounts = 0;
  let unvaluedNonZero = 0;
  for (const variance of variances) {
    if (!nonEmptyString(variance?.countClosedAt)) unclosedCounts += 1;
    try {
      const quantity = integerString(variance.varianceQuantityBase, 'inventory variance');
      if (
        quantity !== 0n &&
        (variance.valuationStatus !== 'VALUED' ||
          variance.unitCostMinor === null ||
          variance.varianceValueMinor === null ||
          !nonEmptyString(variance.valuationCurrency))
      ) {
        unvaluedNonZero += 1;
      }
    } catch {
      unvaluedNonZero += 1;
    }
  }
  checks.push(
    check(
      'inventory:physical-counts',
      variances.length > 0 && unclosedCounts === 0,
      `varianceRows=${variances.length}; rowsWithoutClosedCount=${unclosedCounts}`,
      gate,
    ),
  );
  checks.push(
    check(
      'inventory:variance-valuation',
      unvaluedNonZero === 0,
      `unvaluedNonZeroVariances=${unvaluedNonZero}`,
      gate,
    ),
  );
}

export function verifyEventCloseEvidence(bundle, expectedReleaseCommit, now = new Date()) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    throw new Error('event-close evidence bundle must be a JSON object');
  }
  if (!RELEASE_PATTERN.test(expectedReleaseCommit ?? '')) {
    throw new Error('expectedReleaseCommit must be a lowercase 40-character Git SHA');
  }
  if (bundle.schemaVersion !== 1) throw new Error('bundle.schemaVersion must equal 1');
  if (!RELEASE_PATTERN.test(bundle.releaseCommit ?? '')) {
    throw new Error('bundle.releaseCommit must be a lowercase 40-character Git SHA');
  }
  if (!nonEmptyString(bundle.eventId)) throw new Error('bundle.eventId is required');

  const checks = [];
  const expected = expectedReleaseCommit;

  checks.push(
    check(
      'release:bundle',
      bundle.releaseCommit === expected,
      `bundle=${bundle.releaseCommit}; expected=${expected}`,
      'controlledPilotClose',
    ),
  );
  checks.push(
    check(
      'release:cloud-health',
      bundle.runtimeHealth?.service === 'cloud-api' &&
        bundle.runtimeHealth?.status === 'ok' &&
        bundle.runtimeHealth?.releaseCommit === expected,
      `service=${bundle.runtimeHealth?.service ?? '<missing>'}; status=${bundle.runtimeHealth?.status ?? '<missing>'}; release=${bundle.runtimeHealth?.releaseCommit ?? '<missing>'}`,
      'controlledPilotClose',
    ),
  );

  const live = bundle.liveReport;
  checks.push(
    check(
      'close:live-report-event',
      eventMatches(live, bundle.eventId),
      `liveReport.eventId=${live?.event?.eventId ?? '<missing>'}`,
      'controlledPilotClose',
    ),
  );
  checks.push(
    check(
      'close:operational-state',
      live?.close?.state === 'OPERATIONALLY_CLOSED',
      `close.state=${live?.close?.state ?? '<missing>'}`,
      'controlledPilotClose',
    ),
  );
  checks.push(
    check(
      'close:source-stable',
      live?.close?.sourceChangedSinceLastClose === false,
      `sourceChangedSinceLastClose=${String(live?.close?.sourceChangedSinceLastClose)}`,
      'controlledPilotClose',
    ),
  );

  const reports = Array.isArray(bundle.storedReports)
    ? [...bundle.storedReports].sort((left, right) => left.revision - right.revision)
    : [];
  checks.push(
    check(
      'close:stored-report-history',
      reports.length > 0 && reports.every((report, index) => report?.revision === index + 1),
      `storedReports=${reports.length}; revisions=${reports.map((report) => report?.revision).join(',')}`,
      'controlledPilotClose',
    ),
  );

  let storedHashFailures = 0;
  let storedIdentityFailures = 0;
  for (const stored of reports) {
    const hashMatches =
      SHA256_PATTERN.test(stored?.sha256 ?? '') && stored.sha256 === reportHash(stored.report);
    if (!hashMatches) storedHashFailures += 1;

    const identityMatches =
      stored?.eventId === bundle.eventId &&
      eventMatches(stored?.report, bundle.eventId) &&
      stored?.sourceVersionToken === stored?.report?.sourceVersionToken &&
      stored?.report?.close?.state === 'OPERATIONALLY_CLOSED' &&
      stored?.report?.close?.lastClosedRevision === stored?.revision &&
      stored?.report?.close?.lastClosedReportId === stored?.reportId &&
      stored?.report?.close?.sourceVersionAtLastClose === stored?.sourceVersionToken &&
      stored?.report?.close?.sourceChangedSinceLastClose === false;
    if (!identityMatches) storedIdentityFailures += 1;
  }

  checks.push(
    check(
      'close:stored-report-hashes',
      reports.length > 0 && storedHashFailures === 0,
      `hashFailures=${storedHashFailures}`,
      'controlledPilotClose',
    ),
  );
  checks.push(
    check(
      'close:stored-report-identity',
      reports.length > 0 && storedIdentityFailures === 0,
      `identityFailures=${storedIdentityFailures}`,
      'controlledPilotClose',
    ),
  );

  const latest = reports.at(-1);
  checks.push(
    check(
      'close:latest-live-alignment',
      Boolean(latest) &&
        live?.close?.lastClosedRevision === latest.revision &&
        live?.close?.lastClosedReportId === latest.reportId &&
        live?.close?.sourceVersionAtLastClose === latest.sourceVersionToken &&
        live?.sourceVersionToken === latest.sourceVersionToken,
      latest
        ? `latestRevision=${latest.revision}; liveRevision=${live?.close?.lastClosedRevision ?? '<missing>'}`
        : 'no stored close report',
      'controlledPilotClose',
    ),
  );

  const actions = Array.isArray(bundle.actions) ? bundle.actions : [];
  const latestAction = actions.at(-1);
  checks.push(
    check(
      'close:latest-action',
      Boolean(latest) &&
        latestAction?.eventId === bundle.eventId &&
        latestAction?.action === 'OPERATIONALLY_CLOSE' &&
        latestAction?.closeRevision === latest.revision &&
        latestAction?.reportId === latest.reportId,
      `actions=${actions.length}; latestAction=${latestAction?.action ?? '<missing>'}; latestRevision=${latestAction?.closeRevision ?? '<missing>'}`,
      'controlledPilotClose',
    ),
  );

  checks.push(
    check(
      'close:csv-export',
      Boolean(latest) &&
        bundle.latestStoredCsv?.revision === latest.revision &&
        SHA256_PATTERN.test(bundle.latestStoredCsv?.sha256 ?? '') &&
        Number.isSafeInteger(bundle.latestStoredCsv?.byteLength) &&
        bundle.latestStoredCsv.byteLength > 0,
      `csvRevision=${bundle.latestStoredCsv?.revision ?? '<missing>'}; bytes=${bundle.latestStoredCsv?.byteLength ?? '<missing>'}`,
      'controlledPilotClose',
    ),
  );

  if (live && typeof live === 'object') {
    paymentChecks(live, checks);
    financialChecks(live, checks);
    cashChecks(live, checks);
    inventoryChecks(live, checks);
  } else {
    checks.push(
      check('close:report-shape', false, 'liveReport must be an object', 'controlledPilotClose'),
    );
  }

  const controlledPilotCloseSatisfied = checks
    .filter((item) => item.gate === 'controlledPilotClose')
    .every((item) => item.status === 'PASS');
  const inventoryCloseReconciliationSatisfied = checks
    .filter((item) => item.gate === 'inventoryCloseReconciliation')
    .every((item) => item.status === 'PASS');

  return {
    schemaVersion: 1,
    releaseCommit: bundle.releaseCommit,
    eventId: bundle.eventId,
    verifiedAt: now.toISOString(),
    controlledPilotCloseSatisfied,
    inventoryCloseReconciliationSatisfied,
    liveMoneyApproved: false,
    checks,
  };
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function collectCommand(outputPath) {
  const bundle = await collectEventCloseEvidence({
    baseUrl: required('CLOUD_API_BASE_URL'),
    eventId: required('EVENT_ID'),
    operatorBearer: required('OPERATOR_BEARER'),
    expectedReleaseCommit: required('PILOT_EVIDENCE_RELEASE_COMMIT'),
  });
  const absolute = resolve(
    outputPath || `artifacts/pilot-evidence/event-close-${bundle.releaseCommit}.json`,
  );
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(bundle, null, 2)}\n`, { mode: 0o600 });
  console.log(`Event-close evidence written: ${absolute}`);
}

function verifyCommand(inputPath, outputPath) {
  if (!inputPath) throw new Error('verify requires an evidence bundle path');
  const bundle = JSON.parse(readFileSync(resolve(inputPath), 'utf8'));
  const report = verifyEventCloseEvidence(bundle, required('PILOT_EVIDENCE_RELEASE_COMMIT'));
  if (outputPath) {
    const absolute = resolve(outputPath);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  }
  if (report.controlledPilotCloseSatisfied && report.inventoryCloseReconciliationSatisfied) {
    console.log('Event-close field evidence: PASS');
    return;
  }
  console.error('Event-close field evidence: BLOCKED');
  for (const item of report.checks.filter((candidate) => candidate.status === 'FAIL')) {
    console.error(`- ${item.id}: ${item.details}`);
  }
  process.exitCode = 1;
}

function usage() {
  console.log('Usage:');
  console.log('  node scripts/event-close-evidence.mjs collect [output.json]');
  console.log('  node scripts/event-close-evidence.mjs verify <bundle.json> [report.json]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const command = process.argv[2];
    if (command === 'collect') await collectCommand(process.argv[3]);
    else if (command === 'verify') verifyCommand(process.argv[3], process.argv[4]);
    else {
      usage();
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
