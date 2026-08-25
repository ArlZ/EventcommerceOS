import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA_PATTERN = /^[0-9a-f]{40}$/;

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function integer(value, label, { minimum = 0 } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label} must be an integer >= ${minimum}`);
  }
  return value;
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

function validateSnapshot(snapshot, label, releaseCommit, eventId) {
  const errors = [];
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return [`${label} must be a JSON object`];
  }
  if (snapshot.schemaVersion !== 1) errors.push(`${label}.schemaVersion must equal 1`);
  if (snapshot.releaseCommit !== releaseCommit) {
    errors.push(`${label}.releaseCommit must equal ${releaseCommit}`);
  }
  if (snapshot.eventId !== eventId) errors.push(`${label}.eventId must equal ${eventId}`);
  if (!nonEmptyString(snapshot.generatedAt)) errors.push(`${label}.generatedAt is required`);
  for (const field of ['unresolvedSyncExceptionCount', 'unresolvedInventoryExceptionCount']) {
    if (!Number.isSafeInteger(snapshot[field]) || snapshot[field] < 0) {
      errors.push(`${label}.${field} must be a non-negative safe integer`);
    }
  }
  for (const field of [
    'processedEvents',
    'orders',
    'inventoryEdgeEvents',
    'inventoryLedger',
    'stockProjection',
  ]) {
    if (!Array.isArray(snapshot[field])) errors.push(`${label}.${field} must be an array`);
  }
  return errors;
}

function closedOrderIds(snapshot) {
  return new Set(
    snapshot.orders
      .filter((order) => order?.state === 'CLOSED' && nonEmptyString(order.orderId))
      .map((order) => order.orderId),
  );
}

function uniqueBy(items, selector) {
  return new Set(items.map(selector)).size === items.length;
}

function stableBusinessView(snapshot) {
  return {
    processedEvents: snapshot.processedEvents,
    orders: snapshot.orders,
    inventoryEdgeEvents: snapshot.inventoryEdgeEvents,
    inventoryLedger: snapshot.inventoryLedger,
    stockProjection: snapshot.stockProjection,
    unresolvedSyncExceptionCount: snapshot.unresolvedSyncExceptionCount,
    unresolvedInventoryExceptionCount: snapshot.unresolvedInventoryExceptionCount,
  };
}

export function verifyCloudConvergenceEvidence({
  manifest,
  durabilityReport,
  baseline,
  firstDrain,
  afterDuplicateReplay,
  now = new Date(),
}) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('cloud convergence manifest must be a JSON object');
  }
  if (manifest.schemaVersion !== 1) throw new Error('manifest.schemaVersion must equal 1');
  if (!SHA_PATTERN.test(manifest.releaseCommit ?? '')) {
    throw new Error('manifest.releaseCommit must be a lowercase 40-character Git SHA');
  }
  if (!nonEmptyString(manifest.eventId)) throw new Error('manifest.eventId is required');
  const minimumNewClosedOrders = integer(
    manifest.minimumNewClosedOrders,
    'manifest.minimumNewClosedOrders',
    { minimum: 100 },
  );

  if (!durabilityReport || typeof durabilityReport !== 'object' || Array.isArray(durabilityReport)) {
    throw new Error('durability report must be a JSON object');
  }

  const checks = [];
  checks.push(
    check(
      'durability:pass',
      durabilityReport.status === 'PASS',
      `durability status=${durabilityReport.status ?? 'missing'}`,
    ),
  );
  checks.push(
    check(
      'durability:release-identity',
      durabilityReport.releaseCommit === manifest.releaseCommit,
      `durability release=${durabilityReport.releaseCommit ?? 'missing'}`,
    ),
  );
  checks.push(
    check(
      'durability:event-identity',
      durabilityReport.eventId === manifest.eventId,
      `durability event=${durabilityReport.eventId ?? 'missing'}`,
    ),
  );
  checks.push(
    check(
      'durability:minimum-orders',
      Number.isSafeInteger(durabilityReport.aggregateNewClosedOrders) &&
        durabilityReport.aggregateNewClosedOrders >= minimumNewClosedOrders,
      `durability new closed orders=${durabilityReport.aggregateNewClosedOrders ?? 'invalid'}; required>=${minimumNewClosedOrders}`,
    ),
  );

  const snapshots = [
    ['baseline', baseline],
    ['firstDrain', firstDrain],
    ['afterDuplicateReplay', afterDuplicateReplay],
  ];
  let snapshotsValid = true;
  for (const [label, snapshot] of snapshots) {
    const errors = validateSnapshot(snapshot, label, manifest.releaseCommit, manifest.eventId);
    if (errors.length) snapshotsValid = false;
    checks.push(
      check(
        `cloud:${label}:schema`,
        errors.length === 0,
        errors.length === 0
          ? 'snapshot schema and release/event identity are valid'
          : errors.join('; '),
      ),
    );
  }

  let newCloudClosedOrders = 0;
  let replayBusinessDigest = null;
  let firstDrainBusinessDigest = null;

  if (snapshotsValid) {
    const baselineClosed = closedOrderIds(baseline);
    const firstClosed = closedOrderIds(firstDrain);
    const replayClosed = closedOrderIds(afterDuplicateReplay);
    newCloudClosedOrders = [...firstClosed].filter((orderId) => !baselineClosed.has(orderId)).length;
    const expectedNewClosedOrders = durabilityReport.aggregateNewClosedOrders;

    checks.push(
      check(
        'cloud:first-drain:new-closed-orders-match-pos',
        Number.isSafeInteger(expectedNewClosedOrders) &&
          newCloudClosedOrders === expectedNewClosedOrders,
        `Cloud new closed orders=${newCloudClosedOrders}; POS durability new closed orders=${expectedNewClosedOrders ?? 'invalid'}`,
      ),
    );
    checks.push(
      check(
        'cloud:first-drain:minimum-orders',
        newCloudClosedOrders >= minimumNewClosedOrders,
        `Cloud new closed orders=${newCloudClosedOrders}; required>=${minimumNewClosedOrders}`,
      ),
    );
    checks.push(
      check(
        'cloud:first-drain:processed-events-advanced',
        firstDrain.processedEvents.length > baseline.processedEvents.length,
        `processed events baseline=${baseline.processedEvents.length}; firstDrain=${firstDrain.processedEvents.length}`,
      ),
    );
    checks.push(
      check(
        'cloud:first-drain:sync-reconciliation-clean',
        firstDrain.unresolvedSyncExceptionCount === 0,
        `unresolvedSyncExceptionCount=${firstDrain.unresolvedSyncExceptionCount}`,
      ),
    );
    checks.push(
      check(
        'cloud:first-drain:inventory-reconciliation-clean',
        firstDrain.unresolvedInventoryExceptionCount === 0,
        `unresolvedInventoryExceptionCount=${firstDrain.unresolvedInventoryExceptionCount}`,
      ),
    );

    checks.push(
      check(
        'cloud:first-drain:processed-event-ids-unique',
        uniqueBy(firstDrain.processedEvents, (entry) => entry.eventInstanceId),
        `processed event count=${firstDrain.processedEvents.length}`,
      ),
    );
    checks.push(
      check(
        'cloud:first-drain:inventory-edge-event-ids-unique',
        uniqueBy(firstDrain.inventoryEdgeEvents, (entry) => entry.id),
        `inventory Edge event count=${firstDrain.inventoryEdgeEvents.length}`,
      ),
    );
    checks.push(
      check(
        'cloud:first-drain:inventory-ledger-ids-unique',
        uniqueBy(firstDrain.inventoryLedger, (entry) => entry.id),
        `inventory ledger count=${firstDrain.inventoryLedger.length}`,
      ),
    );
    checks.push(
      check(
        'cloud:first-drain:inventory-idempotency-keys-unique',
        uniqueBy(firstDrain.inventoryLedger, (entry) => entry.idempotencyKey),
        `inventory ledger count=${firstDrain.inventoryLedger.length}`,
      ),
    );

    firstDrainBusinessDigest = digest(stableBusinessView(firstDrain));
    replayBusinessDigest = digest(stableBusinessView(afterDuplicateReplay));
    checks.push(
      check(
        'cloud:duplicate-replay:no-business-effect',
        firstDrainBusinessDigest === replayBusinessDigest,
        `firstDrain business digest=${firstDrainBusinessDigest}; afterDuplicateReplay business digest=${replayBusinessDigest}`,
      ),
    );
    checks.push(
      check(
        'cloud:duplicate-replay:closed-orders-stable',
        digest([...firstClosed].sort()) === digest([...replayClosed].sort()),
        `closed orders firstDrain=${firstClosed.size}; afterDuplicateReplay=${replayClosed.size}`,
      ),
    );
    checks.push(
      check(
        'cloud:duplicate-replay:reconciliation-clean',
        afterDuplicateReplay.unresolvedSyncExceptionCount === 0 &&
          afterDuplicateReplay.unresolvedInventoryExceptionCount === 0,
        `sync=${afterDuplicateReplay.unresolvedSyncExceptionCount}; inventory=${afterDuplicateReplay.unresolvedInventoryExceptionCount}`,
      ),
    );

    const generatedAt = snapshots.map(([, snapshot]) => Date.parse(snapshot.generatedAt));
    checks.push(
      check(
        'cloud:checkpoint-order',
        generatedAt.every(Number.isFinite) &&
          generatedAt[0] <= generatedAt[1] &&
          generatedAt[1] <= generatedAt[2],
        `timestamps=${snapshots.map(([, snapshot]) => snapshot.generatedAt).join(' -> ')}`,
      ),
    );
  }

  const gateBSatisfied = checks.every((entry) => entry.status === 'PASS');
  const core = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    releaseCommit: manifest.releaseCommit,
    eventId: manifest.eventId,
    minimumNewClosedOrders,
    newCloudClosedOrders,
    status: gateBSatisfied ? 'PASS' : 'FAIL',
    checks,
    gateBSatisfied,
    firstDrainBusinessDigestSha256: firstDrainBusinessDigest,
    afterDuplicateReplayBusinessDigestSha256: replayBusinessDigest,
    scope:
      'Combines the existing POS/Edge durability PASS with independent Cloud order/inventory state captured before first drain, after first drain, and after deliberate duplicate replay.',
    liveMoneyApproved: false,
  };
  return {
    ...core,
    reportDigestSha256: digest(core),
  };
}

function usage() {
  console.error('Usage: node scripts/cloud-convergence-evidence.mjs <manifest.json> [output.json]');
}

async function main() {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    usage();
    process.exitCode = 2;
    return;
  }
  const manifest = readJson(manifestPath, 'cloud convergence manifest');
  const manifestDir = dirname(resolve(manifestPath));
  for (const field of ['durabilityReport', 'baseline', 'firstDrain', 'afterDuplicateReplay']) {
    if (!nonEmptyString(manifest[field])) throw new Error(`manifest.${field} path is required`);
  }

  const report = verifyCloudConvergenceEvidence({
    manifest,
    durabilityReport: readJson(resolve(manifestDir, manifest.durabilityReport), 'durabilityReport'),
    baseline: readJson(resolve(manifestDir, manifest.baseline), 'baseline'),
    firstDrain: readJson(resolve(manifestDir, manifest.firstDrain), 'firstDrain'),
    afterDuplicateReplay: readJson(
      resolve(manifestDir, manifest.afterDuplicateReplay),
      'afterDuplicateReplay',
    ),
  });
  const outputPath = resolve(process.argv[3] ?? 'artifacts/pilot/cloud-convergence-evidence.json');
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(
    `Cloud convergence evidence ${report.status}: ${outputPath} digest=${report.reportDigestSha256}`,
  );
  if (report.status !== 'PASS') process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
