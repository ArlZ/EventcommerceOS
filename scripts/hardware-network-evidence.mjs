import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function finiteAtLeast(value, minimum) {
  return Number.isFinite(value) && value >= minimum;
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

function check(id, passed, details) {
  return { id, status: passed ? 'PASS' : 'FAIL', details };
}

function distinctNonEmpty(items, field) {
  const values = items.map((item) => item?.[field]).filter(nonEmpty);
  return values.length === items.length && new Set(values).size === values.length;
}

function validateEdge(edge, releaseCommit) {
  const errors = [];
  if (!edge || typeof edge !== 'object' || Array.isArray(edge)) {
    return ['edge must be an object'];
  }
  if (!nonEmpty(edge.hostId)) errors.push('edge.hostId is required');
  if (edge.releaseCommit !== releaseCommit) {
    errors.push('edge.releaseCommit must match the exact release');
  }
  if (edge.postgresHealthy !== true) errors.push('edge.postgresHealthy must be true');
  if (!finiteAtLeast(edge.diskFreeGb, 0)) errors.push('edge.diskFreeGb must be non-negative');
  if (!finiteAtLeast(edge.minimumDiskFreeGb, 0)) {
    errors.push('edge.minimumDiskFreeGb must be non-negative');
  } else if (finiteAtLeast(edge.diskFreeGb, 0) && edge.diskFreeGb < edge.minimumDiskFreeGb) {
    errors.push('edge.diskFreeGb is below the recorded minimum');
  }
  if (edge.clockSynchronized !== true) errors.push('edge.clockSynchronized must be true');
  if (edge.restartTestPassed !== true) errors.push('edge.restartTestPassed must be true');
  if (edge.staticOrReservedLanAddress !== true) {
    errors.push('edge.staticOrReservedLanAddress must be true');
  }
  if (edge.durableStorageVerified !== true) errors.push('edge.durableStorageVerified must be true');
  if (edge.backupPathVerified !== true) errors.push('edge.backupPathVerified must be true');
  if (edge.upsOrPowerBackupVerified !== true) {
    errors.push('edge.upsOrPowerBackupVerified must be true');
  }
  return errors;
}

function validateNetwork(network) {
  const errors = [];
  if (!network || typeof network !== 'object' || Array.isArray(network)) {
    return ['network must be an object'];
  }
  if (network.dhcpHeadroomConfirmed !== true) {
    errors.push('network.dhcpHeadroomConfirmed must be true');
  }
  if (network.wanDisconnectedDuringLanTest !== true) {
    errors.push('network.wanDisconnectedDuringLanTest must be true');
  }
  if (network.posToEdgeContinuedWithoutWan !== true) {
    errors.push('network.posToEdgeContinuedWithoutWan must be true');
  }
  if (!Array.isArray(network.locationSamples) || network.locationSamples.length === 0) {
    errors.push('network.locationSamples must contain at least one sales-location sample');
  } else {
    const ids = new Set();
    for (const [index, sample] of network.locationSamples.entries()) {
      const label = `network.locationSamples[${index}]`;
      if (!nonEmpty(sample?.salesLocationId)) {
        errors.push(`${label}.salesLocationId is required`);
      } else if (ids.has(sample.salesLocationId)) {
        errors.push(`${label}.salesLocationId must be unique`);
      } else {
        ids.add(sample.salesLocationId);
      }
      if (sample?.posToEdgeReachable !== true) {
        errors.push(`${label}.posToEdgeReachable must be true`);
      }
      if (!finiteAtLeast(sample?.latencyP95Ms, 0)) {
        errors.push(`${label}.latencyP95Ms must be non-negative`);
      }
      if (
        !finiteAtLeast(sample?.packetLossPercent, 0) ||
        sample.packetLossPercent > 100
      ) {
        errors.push(`${label}.packetLossPercent must be between 0 and 100`);
      }
    }
  }
  return errors;
}

function validateDevices(devices, releaseCommit) {
  const errors = [];
  if (!Array.isArray(devices) || devices.length < 2) {
    return ['devices must contain at least two physical POS devices'];
  }

  if (!distinctNonEmpty(devices, 'assetId')) errors.push('device assetId values must be present and unique');
  if (!distinctNonEmpty(devices, 'registerId')) {
    errors.push('device registerId values must be present and unique');
  }
  if (!distinctNonEmpty(devices, 'credentialIdHash')) {
    errors.push('device credentialIdHash values must be present and unique');
  }

  for (const [index, device] of devices.entries()) {
    const label = `devices[${index}]`;
    if (device.releaseCommit !== releaseCommit) {
      errors.push(`${label}.releaseCommit must match the exact release`);
    }
    if (!SHA256_PATTERN.test(device.credentialIdHash ?? '')) {
      errors.push(`${label}.credentialIdHash must be a lowercase SHA-256 digest`);
    }
    if (device.credentialRevocable !== true) {
      errors.push(`${label}.credentialRevocable must be true`);
    }
    if (device.batteryChecked !== true) errors.push(`${label}.batteryChecked must be true`);
    if (device.timezoneCorrect !== true) errors.push(`${label}.timezoneCorrect must be true`);
    if (device.eventMenuCached !== true) errors.push(`${label}.eventMenuCached must be true`);
    if (device.coldStartWithoutWan !== true) {
      errors.push(`${label}.coldStartWithoutWan must be true`);
    }
    if (device.localOrderCommitted !== true) {
      errors.push(`${label}.localOrderCommitted must be true`);
    }
    if (device.localStateSurvivedRestart !== true) {
      errors.push(`${label}.localStateSurvivedRestart must be true`);
    }
    if (device.reconnectSyncPassed !== true) {
      errors.push(`${label}.reconnectSyncPassed must be true`);
    }
  }
  return errors;
}

export function verifyHardwareNetworkFieldEvidence(input, now = new Date()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('hardware/network field evidence must be a JSON object');
  }

  const checks = [];
  const releaseCommit = input.releaseCommit ?? '';
  checks.push(check('schema', input.schemaVersion === 1, 'schemaVersion must equal 1'));
  checks.push(
    check(
      'release',
      SHA_PATTERN.test(releaseCommit),
      'releaseCommit must be a lowercase 40-character Git SHA',
    ),
  );
  checks.push(check('event', nonEmpty(input.eventId), 'eventId is required'));
  checks.push(check('venue', nonEmpty(input.venue), 'venue is required'));
  checks.push(check('operator', nonEmpty(input.operator), 'operator is required'));
  checks.push(
    check(
      'live-money-boundary',
      input.liveMoneyApproved === false,
      'liveMoneyApproved must be explicitly false',
    ),
  );

  const edgeErrors = validateEdge(input.edge, releaseCommit);
  checks.push(
    check(
      'edge-host',
      edgeErrors.length === 0,
      edgeErrors.length ? edgeErrors.join('; ') : 'Event Edge host checks passed',
    ),
  );

  const networkErrors = validateNetwork(input.network);
  checks.push(
    check(
      'venue-lan',
      networkErrors.length === 0,
      networkErrors.length ? networkErrors.join('; ') : 'venue LAN checks passed',
    ),
  );

  const deviceErrors = validateDevices(input.devices, releaseCommit);
  checks.push(
    check(
      'physical-pos-devices',
      deviceErrors.length === 0,
      deviceErrors.length ? deviceErrors.join('; ') : 'physical POS device checks passed',
    ),
  );

  const allPass = checks.every((entry) => entry.status === 'PASS');
  const samples = Array.isArray(input.network?.locationSamples) ? input.network.locationSamples : [];
  const core = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    releaseCommit: releaseCommit || null,
    eventId: input.eventId ?? null,
    venue: input.venue ?? null,
    status: allPass ? 'PASS' : 'FAIL',
    hardwareNetworkSatisfied: allPass,
    liveMoneyApproved: false,
    checks,
    summary: {
      edgeHostId: input.edge?.hostId ?? null,
      physicalDeviceCount: Array.isArray(input.devices) ? input.devices.length : 0,
      salesLocationSampleCount: samples.length,
      worstLatencyP95Ms:
        samples.length > 0
          ? Math.max(...samples.map((sample) => Number(sample.latencyP95Ms) || 0))
          : null,
      worstPacketLossPercent:
        samples.length > 0
          ? Math.max(...samples.map((sample) => Number(sample.packetLossPercent) || 0))
          : null,
    },
    scope:
      'Controlled-pilot physical Event Edge, venue LAN and POS device evidence. This report cannot approve live money or replace offline durability, payment, abuse, recovery or close/reconciliation gates.',
  };

  return { ...core, reportDigestSha256: digest(core) };
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(resolve(path), 'utf8'));
  } catch (error) {
    throw new Error(`unable to read hardware/network evidence JSON ${path}: ${error.message}`);
  }
}

function usage() {
  console.error('Usage: node scripts/hardware-network-evidence.mjs <input.json> [output.json]');
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    usage();
    process.exitCode = 2;
    return;
  }
  const report = verifyHardwareNetworkFieldEvidence(readJson(inputPath));
  const outputPath = resolve(
    process.argv[3] ?? 'artifacts/pilot/hardware-network-field-evidence.json',
  );
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(
    `Hardware/network field evidence ${report.status}: ${outputPath} digest=${report.reportDigestSha256}`,
  );
  if (report.status !== 'PASS') process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
