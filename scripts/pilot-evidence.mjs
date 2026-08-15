import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const GATE_STATUSES = new Set(['NOT_RUN', 'PASS', 'FAIL']);
const DEPLOYMENT_MODES = new Set(['single_instance_pilot', 'upstream_distributed']);

export const REQUIRED_GATES = [
  'branchProtection',
  'dependencySecurity',
  'representativeRecovery',
  'abuseFloodExercise',
  'hardwareNetwork',
  'paymentFaultMatrix',
  'offlineDurability',
  'inventoryCloseReconciliation',
  'controlledPilotClose',
];

export const REQUIRED_OWNERS = [
  'eventOperationsLead',
  'technicalIncidentLead',
  'financeReconciliationOwner',
  'inventoryOwner',
  'securityReleaseReviewer',
];

function gitHead() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

function configuredReleaseCommit() {
  const candidate = process.env.PILOT_EVIDENCE_RELEASE_COMMIT?.trim() || gitHead();
  if (!SHA_PATTERN.test(candidate)) {
    throw new Error('PILOT_EVIDENCE_RELEASE_COMMIT must be a lowercase 40-character git SHA.');
  }
  return candidate;
}

function emptyGate(extra = {}) {
  return {
    status: 'NOT_RUN',
    evidenceRefs: [],
    reviewer: '',
    reviewedAt: '',
    notes: '',
    ...extra,
  };
}

export function createInitialManifest(releaseCommit, now = new Date().toISOString()) {
  if (!SHA_PATTERN.test(releaseCommit)) {
    throw new Error('releaseCommit must be a lowercase 40-character git SHA.');
  }

  return {
    schemaVersion: 1,
    releaseCommit,
    createdAt: now,
    pilot: {
      eventName: '',
      eventDate: '',
      venue: '',
      deploymentMode: '',
    },
    owners: {
      eventOperationsLead: '',
      technicalIncidentLead: '',
      financeReconciliationOwner: '',
      inventoryOwner: '',
      securityReleaseReviewer: '',
    },
    gates: {
      branchProtection: emptyGate(),
      dependencySecurity: emptyGate({ blockingFindings: null }),
      representativeRecovery: emptyGate({ representativeData: false }),
      abuseFloodExercise: emptyGate(),
      hardwareNetwork: emptyGate(),
      paymentFaultMatrix: emptyGate(),
      offlineDurability: emptyGate(),
      inventoryCloseReconciliation: emptyGate(),
      controlledPilotClose: emptyGate(),
    },
  };
}

function isNonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validatePassEvidence(gateName, gate, blockers) {
  if (!Array.isArray(gate.evidenceRefs) || gate.evidenceRefs.length === 0) {
    blockers.push(`${gateName}: PASS requires at least one evidenceRefs entry.`);
  } else if (gate.evidenceRefs.some((ref) => !isNonEmpty(ref))) {
    blockers.push(`${gateName}: evidenceRefs must contain only non-empty strings.`);
  }

  if (!isNonEmpty(gate.reviewer)) {
    blockers.push(`${gateName}: PASS requires a named reviewer.`);
  }

  if (!isNonEmpty(gate.reviewedAt) || !RFC3339_PATTERN.test(gate.reviewedAt)) {
    blockers.push(`${gateName}: PASS requires reviewedAt in RFC3339 format.`);
  }
}

export function validateManifest(manifest, expectedReleaseCommit) {
  const blockers = [];

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, blockers: ['Evidence manifest must be a JSON object.'] };
  }

  if (manifest.schemaVersion !== 1) {
    blockers.push('schemaVersion must equal 1.');
  }

  if (!SHA_PATTERN.test(manifest.releaseCommit ?? '')) {
    blockers.push('releaseCommit must be a lowercase 40-character git SHA.');
  }

  if (expectedReleaseCommit && manifest.releaseCommit !== expectedReleaseCommit) {
    blockers.push(
      `releaseCommit ${manifest.releaseCommit ?? '<missing>'} does not match expected release ${expectedReleaseCommit}.`,
    );
  }

  if (!isNonEmpty(manifest.createdAt) || !RFC3339_PATTERN.test(manifest.createdAt)) {
    blockers.push('createdAt must be an RFC3339 timestamp.');
  }

  for (const field of ['eventName', 'venue']) {
    if (!isNonEmpty(manifest.pilot?.[field])) {
      blockers.push(`pilot.${field} is required.`);
    }
  }

  if (!isNonEmpty(manifest.pilot?.eventDate) || !DATE_PATTERN.test(manifest.pilot.eventDate)) {
    blockers.push('pilot.eventDate must use YYYY-MM-DD.');
  }

  if (!DEPLOYMENT_MODES.has(manifest.pilot?.deploymentMode)) {
    blockers.push('pilot.deploymentMode must be single_instance_pilot or upstream_distributed.');
  }

  for (const owner of REQUIRED_OWNERS) {
    if (!isNonEmpty(manifest.owners?.[owner])) {
      blockers.push(`owners.${owner} is required.`);
    }
  }

  for (const gateName of REQUIRED_GATES) {
    const gate = manifest.gates?.[gateName];
    if (!gate || typeof gate !== 'object' || Array.isArray(gate)) {
      blockers.push(`${gateName}: required gate is missing.`);
      continue;
    }

    if (!GATE_STATUSES.has(gate.status)) {
      blockers.push(`${gateName}: status must be NOT_RUN, PASS or FAIL.`);
      continue;
    }

    if (gate.status !== 'PASS') {
      blockers.push(`${gateName}: status is ${gate.status}; PASS is required.`);
      continue;
    }

    validatePassEvidence(gateName, gate, blockers);
  }

  if (
    manifest.gates?.representativeRecovery?.status === 'PASS' &&
    manifest.gates.representativeRecovery.representativeData !== true
  ) {
    blockers.push(
      'representativeRecovery: PASS requires representativeData=true; synthetic CI recovery is insufficient.',
    );
  }

  if (manifest.gates?.dependencySecurity?.status === 'PASS') {
    if (!Number.isInteger(manifest.gates.dependencySecurity.blockingFindings)) {
      blockers.push('dependencySecurity: PASS requires integer blockingFindings.');
    } else if (manifest.gates.dependencySecurity.blockingFindings !== 0) {
      blockers.push('dependencySecurity: PASS requires blockingFindings=0.');
    }
  }

  return { ok: blockers.length === 0, blockers };
}

function printValidation(result) {
  if (result.ok) {
    console.log('Pilot evidence validation: PASS');
    return;
  }

  console.error(`Pilot evidence validation: BLOCKED (${result.blockers.length} issue(s))`);
  for (const blocker of result.blockers) console.error(`- ${blocker}`);
}

function initCommand(outputPath) {
  const releaseCommit = configuredReleaseCommit();
  const absolute = resolve(
    outputPath || `artifacts/pilot-evidence/pilot-evidence-${releaseCommit}.json`,
  );
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(createInitialManifest(releaseCommit), null, 2)}\n`, {
    mode: 0o600,
  });
  console.log(`Initialized blocked pilot evidence manifest: ${absolute}`);
  console.log(
    'All release gates are NOT_RUN. Populate real evidence and run validate before any go/no-go review.',
  );
}

function validateCommand(inputPath) {
  if (!inputPath) throw new Error('validate requires a manifest path.');
  const manifest = JSON.parse(readFileSync(resolve(inputPath), 'utf8'));
  const result = validateManifest(manifest, configuredReleaseCommit());
  printValidation(result);
  if (!result.ok) process.exitCode = 1;
}

function usage() {
  console.log('Usage:');
  console.log('  node scripts/pilot-evidence.mjs init [output.json]');
  console.log('  node scripts/pilot-evidence.mjs validate <manifest.json>');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const command = process.argv[2];
    if (command === 'init') initCommand(process.argv[3]);
    else if (command === 'validate') validateCommand(process.argv[3]);
    else {
      usage();
      process.exitCode = 2;
    }
  } catch (error) {
    console.error(
      `Pilot evidence command failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
