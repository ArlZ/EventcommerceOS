import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const CHECKPOINTS = ['baseline', 'offline', 'afterRestart', 'final'];

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

function validatePosSnapshot(snapshot, label, releaseCommit) {
  const errors = [];
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return [`${label} must be a JSON object`];
  }
  if (snapshot.schemaVersion !== 1) errors.push(`${label}.schemaVersion must equal 1`);
  if (snapshot.releaseCommit !== releaseCommit) {
    errors.push(`${label}.releaseCommit must equal ${releaseCommit}`);
  }
  if (!nonEmptyString(snapshot.deviceId)) errors.push(`${label}.deviceId is required`);
  for (const field of [
    'generatedAtEpochMs',
    'closedOrderCount',
    'highestLocalSequence',
    'acknowledgedThroughSequence',
    'pendingAfterAcknowledgement',
    'edgeBacklogCount',
  ]) {
    if (!Number.isSafeInteger(snapshot[field]) || snapshot[field] < 0) {
      errors.push(`${label}.${field} must be a non-negative safe integer`);
    }
  }
  if (typeof snapshot.hasSyncError !== 'boolean') {
    errors.push(`${label}.hasSyncError must be boolean`);
  }
  if (
    Number.isSafeInteger(snapshot.acknowledgedThroughSequence) &&
    Number.isSafeInteger(snapshot.highestLocalSequence) &&
    snapshot.acknowledgedThroughSequence > snapshot.highestLocalSequence
  ) {
    errors.push(`${label}.acknowledgedThroughSequence cannot exceed highestLocalSequence`);
  }
  return errors;
}

function validateEdgeSnapshot(snapshot, releaseCommit, eventId) {
  const errors = [];
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return ['edgeFinal must be a JSON object'];
  }
  if (snapshot.schemaVersion !== 1) errors.push('edgeFinal.schemaVersion must equal 1');
  if (snapshot.releaseCommit !== releaseCommit) {
    errors.push(`edgeFinal.releaseCommit must equal ${releaseCommit}`);
  }
  if (snapshot.eventId !== eventId) errors.push(`edgeFinal.eventId must equal ${eventId}`);
  if (!Array.isArray(snapshot.devices)) errors.push('edgeFinal.devices must be an array');
  if (!snapshot.totals || typeof snapshot.totals !== 'object' || Array.isArray(snapshot.totals)) {
    errors.push('edgeFinal.totals must be an object');
  }
  return errors;
}

function monotonic(values) {
  return values.every((value, index) => index === 0 || value >= values[index - 1]);
}

function same(values) {
  return values.every((value) => value === values[0]);
}

export function verifyDurabilityEvidence({ manifest, posSnapshots, edgeFinal, now = new Date() }) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('durability manifest must be a JSON object');
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
  if (!Array.isArray(manifest.registers) || manifest.registers.length === 0) {
    throw new Error('manifest.registers must contain at least one representative register');
  }

  const checks = [];
  const registerReports = [];
  let aggregateNewClosedOrders = 0;

  for (const register of manifest.registers) {
    if (!register || typeof register !== 'object' || Array.isArray(register)) {
      throw new Error('each manifest.registers entry must be an object');
    }
    const assetId = register.assetId?.trim();
    if (!assetId) throw new Error('each register requires assetId');
    const snapshots = posSnapshots[assetId];
    if (!snapshots) throw new Error(`missing POS snapshots for asset ${assetId}`);

    for (const checkpoint of CHECKPOINTS) {
      const errors = validatePosSnapshot(
        snapshots[checkpoint],
        `${assetId}.${checkpoint}`,
        manifest.releaseCommit,
      );
      checks.push(
        check(
          `pos:${assetId}:${checkpoint}:schema`,
          errors.length === 0,
          errors.length === 0
            ? 'snapshot schema and release identity are valid'
            : errors.join('; '),
        ),
      );
    }

    const invalid = CHECKPOINTS.some(
      (checkpoint) =>
        validatePosSnapshot(
          snapshots[checkpoint],
          `${assetId}.${checkpoint}`,
          manifest.releaseCommit,
        ).length,
    );
    if (invalid) continue;

    const ordered = CHECKPOINTS.map((checkpoint) => snapshots[checkpoint]);
    const deviceIds = ordered.map((snapshot) => snapshot.deviceId);
    const generated = ordered.map((snapshot) => snapshot.generatedAtEpochMs);
    const closedOrders = ordered.map((snapshot) => snapshot.closedOrderCount);
    const localSequences = ordered.map((snapshot) => snapshot.highestLocalSequence);

    checks.push(
      check(
        `pos:${assetId}:device-identity`,
        same(deviceIds),
        same(deviceIds)
          ? `device identity ${deviceIds[0]} is stable across all checkpoints`
          : `device identity changed: ${deviceIds.join(' -> ')}`,
      ),
    );
    checks.push(
      check(
        `pos:${assetId}:checkpoint-order`,
        monotonic(generated),
        monotonic(generated)
          ? 'checkpoint timestamps are monotonic'
          : `checkpoint timestamps are not monotonic: ${generated.join(' -> ')}`,
      ),
    );
    checks.push(
      check(
        `pos:${assetId}:closed-order-monotonicity`,
        monotonic(closedOrders),
        monotonic(closedOrders)
          ? `closed orders ${closedOrders.join(' -> ')}`
          : `closed-order count decreased: ${closedOrders.join(' -> ')}`,
      ),
    );
    checks.push(
      check(
        `pos:${assetId}:sequence-monotonicity`,
        monotonic(localSequences),
        monotonic(localSequences)
          ? `local sequences ${localSequences.join(' -> ')}`
          : `highest local sequence decreased: ${localSequences.join(' -> ')}`,
      ),
    );

    const offline = snapshots.offline;
    const afterRestart = snapshots.afterRestart;
    const final = snapshots.final;
    const newClosedOrders = offline.closedOrderCount - snapshots.baseline.closedOrderCount;
    aggregateNewClosedOrders += Math.max(0, newClosedOrders);

    checks.push(
      check(
        `pos:${assetId}:restart-preserves-orders`,
        afterRestart.closedOrderCount === offline.closedOrderCount,
        `offline=${offline.closedOrderCount}; afterRestart=${afterRestart.closedOrderCount}`,
      ),
    );
    checks.push(
      check(
        `pos:${assetId}:restart-preserves-sequence`,
        afterRestart.highestLocalSequence === offline.highestLocalSequence,
        `offline=${offline.highestLocalSequence}; afterRestart=${afterRestart.highestLocalSequence}`,
      ),
    );
    checks.push(
      check(
        `pos:${assetId}:offline-durable-pending`,
        register.requirePendingOffline === false || offline.pendingAfterAcknowledgement > 0,
        register.requirePendingOffline === false
          ? 'manifest explicitly does not require a POS-local pending event at the offline checkpoint'
          : `offline pendingAfterAcknowledgement=${offline.pendingAfterAcknowledgement}`,
      ),
    );
    checks.push(
      check(
        `pos:${assetId}:final-acknowledgement`,
        final.acknowledgedThroughSequence === final.highestLocalSequence,
        `acknowledged=${final.acknowledgedThroughSequence}; highestLocal=${final.highestLocalSequence}`,
      ),
    );
    checks.push(
      check(
        `pos:${assetId}:final-local-drain`,
        final.pendingAfterAcknowledgement === 0,
        `pendingAfterAcknowledgement=${final.pendingAfterAcknowledgement}`,
      ),
    );
    checks.push(
      check(
        `pos:${assetId}:final-edge-backlog`,
        final.edgeBacklogCount === 0,
        `edgeBacklogCount=${final.edgeBacklogCount}`,
      ),
    );
    checks.push(
      check(
        `pos:${assetId}:final-sync-health`,
        final.hasSyncError === false,
        `hasSyncError=${final.hasSyncError}`,
      ),
    );

    registerReports.push({
      assetId,
      deviceId: final.deviceId,
      newClosedOrdersThroughOfflineCheckpoint: newClosedOrders,
      finalHighestLocalSequence: final.highestLocalSequence,
    });
  }

  checks.push(
    check(
      'pos:aggregate-minimum-orders',
      aggregateNewClosedOrders >= minimumNewClosedOrders,
      `new closed orders=${aggregateNewClosedOrders}; required>=${minimumNewClosedOrders}`,
    ),
  );

  const edgeErrors = validateEdgeSnapshot(edgeFinal, manifest.releaseCommit, manifest.eventId);
  checks.push(
    check(
      'edge:final-schema',
      edgeErrors.length === 0,
      edgeErrors.length === 0
        ? 'Edge snapshot schema and release/event identity are valid'
        : edgeErrors.join('; '),
    ),
  );

  if (edgeErrors.length === 0) {
    const edgeDevices = new Map(edgeFinal.devices.map((device) => [device.deviceId, device]));
    for (const register of registerReports) {
      const edge = edgeDevices.get(register.deviceId);
      checks.push(
        check(
          `edge:${register.assetId}:device-present`,
          Boolean(edge),
          edge
            ? `Edge contains ${register.deviceId}`
            : `Edge does not contain ${register.deviceId}`,
        ),
      );
      if (!edge) continue;
      checks.push(
        check(
          `edge:${register.assetId}:accepted-through`,
          String(edge.acceptedThroughSequence) === String(register.finalHighestLocalSequence),
          `Edge accepted=${edge.acceptedThroughSequence}; POS highest=${register.finalHighestLocalSequence}`,
        ),
      );
      checks.push(
        check(
          `edge:${register.assetId}:highest-seen`,
          String(edge.highestSequenceSeen) === String(register.finalHighestLocalSequence),
          `Edge highestSeen=${edge.highestSequenceSeen}; POS highest=${register.finalHighestLocalSequence}`,
        ),
      );
    }

    const totals = edgeFinal.totals;
    checks.push(
      check(
        'edge:cloud-backlog-drained',
        totals.cloudBacklogCount === 0,
        `cloudBacklogCount=${totals.cloudBacklogCount}`,
      ),
    );
    checks.push(
      check(
        'edge:event-reconciliation-clean',
        totals.unresolvedReconciliationExceptionCount === 0,
        `unresolvedReconciliationExceptionCount=${totals.unresolvedReconciliationExceptionCount}`,
      ),
    );
    checks.push(
      check(
        'edge:host-global-reconciliation-clean',
        totals.hostGlobalUnattributedReconciliationExceptionCount === 0,
        `hostGlobalUnattributedReconciliationExceptionCount=${totals.hostGlobalUnattributedReconciliationExceptionCount}`,
      ),
    );
  }

  const core = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    releaseCommit: manifest.releaseCommit,
    eventId: manifest.eventId,
    minimumNewClosedOrders,
    aggregateNewClosedOrders,
    status: checks.every((entry) => entry.status === 'PASS') ? 'PASS' : 'FAIL',
    checks,
    registers: registerReports,
    gateBSatisfied: false,
    remainingGateBProof:
      'This report proves only POS local durability/restart preservation and POS-to-Edge convergence. Independently prove duplicate replay causes zero duplicate Cloud sales/inventory effects before Gate B can pass.',
  };
  return {
    ...core,
    reportDigestSha256: createHash('sha256').update(JSON.stringify(core)).digest('hex'),
  };
}

function usage() {
  console.error('Usage: node scripts/durability-evidence.mjs <manifest.json> [output.json]');
}

async function main() {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    usage();
    process.exitCode = 2;
    return;
  }
  const manifest = readJson(manifestPath, 'durability manifest');
  const manifestDir = dirname(resolve(manifestPath));
  const posSnapshots = {};
  for (const register of manifest.registers ?? []) {
    const assetId = register.assetId?.trim();
    if (!assetId) continue;
    posSnapshots[assetId] = {};
    for (const checkpoint of CHECKPOINTS) {
      const relativePath = register[checkpoint];
      if (!nonEmptyString(relativePath)) {
        throw new Error(`manifest register ${assetId}.${checkpoint} path is required`);
      }
      posSnapshots[assetId][checkpoint] = readJson(
        resolve(manifestDir, relativePath),
        `${assetId}.${checkpoint}`,
      );
    }
  }
  if (!nonEmptyString(manifest.edgeFinal)) throw new Error('manifest.edgeFinal path is required');
  const edgeFinal = readJson(resolve(manifestDir, manifest.edgeFinal), 'edgeFinal');
  const report = verifyDurabilityEvidence({ manifest, posSnapshots, edgeFinal });
  const outputPath = resolve(process.argv[3] ?? 'artifacts/pilot/durability-evidence.json');
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(
    `Durability evidence ${report.status}: ${outputPath} digest=${report.reportDigestSha256}`,
  );
  if (report.status !== 'PASS') process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
