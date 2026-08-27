import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const GATE_STATUSES = new Set(['NOT_RUN', 'PASS', 'FAIL']);
const DEPLOYMENT_MODES = new Set(['single_instance_pilot', 'upstream_distributed']);

const FIELD_GATE_REPORTS = {
  representativeRecovery: { satisfiedField: 'representativeRecoverySatisfied', requireStatus: true },
  abuseFloodExercise: { satisfiedField: 'abuseGateSatisfied', requireStatus: true },
  hardwareNetwork: { satisfiedField: 'hardwareNetworkSatisfied', requireStatus: true },
  paymentFaultMatrix: { satisfiedField: 'paymentFaultMatrixSatisfied', requireStatus: true },
  offlineDurability: { satisfiedField: 'gateBSatisfied', requireStatus: true },
  inventoryCloseReconciliation: {
    satisfiedField: 'inventoryCloseReconciliationSatisfied',
    requireStatus: false,
  },
  controlledPilotClose: { satisfiedField: 'controlledPilotCloseSatisfied', requireStatus: false },
};

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
    schemaVersion: 2,
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

function safeRelativeEvidencePath(value) {
  if (!isNonEmpty(value) || isAbsolute(value)) return false;
  const segments = value.replaceAll('\\', '/').split('/');
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

export function validateEvidenceRef(ref) {
  const blockers = [];
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) {
    return ['evidence reference must be an object with path and sha256.'];
  }
  if (!safeRelativeEvidencePath(ref.path)) {
    blockers.push('evidence path must be a safe relative path without . or .. segments.');
  }
  if (!SHA256_PATTERN.test(ref.sha256 ?? '')) {
    blockers.push('evidence sha256 must be a lowercase 64-character SHA-256 digest.');
  }
  return blockers;
}

export function applyReviewedFieldEvidence({
  manifest,
  gateName,
  evidenceRef,
  report,
  reviewer,
  reviewedAt,
  notes = '',
}) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('pilot evidence manifest must be a JSON object.');
  }
  if (!SHA_PATTERN.test(manifest.releaseCommit ?? '')) {
    throw new Error('manifest releaseCommit must be a lowercase 40-character git SHA.');
  }

  const contract = FIELD_GATE_REPORTS[gateName];
  if (!contract) {
    throw new Error(
      `gate ${gateName ?? '<missing>'} is not supported by field-evidence review; review branchProtection and dependencySecurity manually.`,
    );
  }

  const refBlockers = validateEvidenceRef(evidenceRef);
  if (refBlockers.length > 0) {
    throw new Error(`invalid evidence reference: ${refBlockers.join(' ')}`);
  }
  if (!isNonEmpty(reviewer)) {
    throw new Error('reviewer must name the person who performed the field-evidence review.');
  }
  if (!isNonEmpty(reviewedAt) || !RFC3339_PATTERN.test(reviewedAt)) {
    throw new Error('reviewedAt must be an RFC3339 timestamp.');
  }
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    throw new Error('field evidence report must be a JSON object.');
  }
  if (report.releaseCommit !== manifest.releaseCommit) {
    throw new Error('field evidence releaseCommit must match the pilot manifest releaseCommit.');
  }
  if (report.liveMoneyApproved !== false) {
    throw new Error('field evidence must explicitly retain liveMoneyApproved=false.');
  }
  if (contract.requireStatus && report.status !== 'PASS') {
    throw new Error(`field evidence report status must equal PASS for ${gateName}.`);
  }
  if (report[contract.satisfiedField] !== true) {
    throw new Error(
      `field evidence report must set ${contract.satisfiedField}=true for ${gateName}.`,
    );
  }

  if (!manifest.gates || typeof manifest.gates !== 'object' || Array.isArray(manifest.gates)) {
    throw new Error('pilot evidence manifest is missing gates.');
  }
  const gate = manifest.gates[gateName];
  if (!gate || typeof gate !== 'object' || Array.isArray(gate)) {
    throw new Error(`pilot evidence manifest is missing gate ${gateName}.`);
  }

  const refs = Array.isArray(gate.evidenceRefs) ? gate.evidenceRefs : [];
  const alreadyPresent = refs.some(
    (ref) => ref?.path === evidenceRef.path && ref?.sha256 === evidenceRef.sha256,
  );
  gate.evidenceRefs = alreadyPresent ? refs : [...refs, evidenceRef];
  gate.status = 'PASS';
  gate.reviewer = reviewer.trim();
  gate.reviewedAt = reviewedAt;
  gate.notes = typeof notes === 'string' ? notes : '';

  if (gateName === 'representativeRecovery') {
    gate.representativeData = true;
  }

  return manifest;
}

function validatePassEvidence(gateName, gate, blockers) {
  if (!Array.isArray(gate.evidenceRefs) || gate.evidenceRefs.length === 0) {
    blockers.push(`${gateName}: PASS requires at least one evidenceRefs entry.`);
  } else {
    gate.evidenceRefs.forEach((ref, index) => {
      for (const blocker of validateEvidenceRef(ref)) {
        blockers.push(`${gateName}: evidenceRefs[${index}] ${blocker}`);
      }
    });
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

  if (manifest.schemaVersion !== 2) {
    blockers.push('schemaVersion must equal 2.');
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

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function pathEscapesRoot(root, candidate) {
  const rel = relative(root, candidate);
  return rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel);
}

function inspectedEvidencePath(manifestPath, evidencePath) {
  const manifestAbsolute = resolve(manifestPath);
  const evidenceRoot = realpathSync(dirname(manifestAbsolute));
  const requested = resolve(evidencePath);
  const actualPath = realpathSync(requested);

  if (pathEscapesRoot(evidenceRoot, actualPath)) {
    throw new Error('evidence file must be retained under the manifest directory.');
  }

  if (!lstatSync(actualPath).isFile()) {
    throw new Error('evidence path must resolve to a regular file.');
  }

  return { evidenceRoot, actualPath };
}

export function createEvidenceRef(manifestPath, evidencePath) {
  const { evidenceRoot, actualPath } = inspectedEvidencePath(manifestPath, evidencePath);
  return {
    path: relative(evidenceRoot, actualPath).replaceAll('\\', '/'),
    sha256: sha256File(actualPath),
  };
}

export function validateEvidenceFiles(manifest, manifestPath) {
  const blockers = [];
  const manifestAbsolute = resolve(manifestPath);
  const evidenceRoot = realpathSync(dirname(manifestAbsolute));

  for (const gateName of REQUIRED_GATES) {
    const gate = manifest.gates?.[gateName];
    if (gate?.status !== 'PASS' || !Array.isArray(gate.evidenceRefs)) continue;

    gate.evidenceRefs.forEach((ref, index) => {
      if (validateEvidenceRef(ref).length > 0) return;
      const candidate = resolve(evidenceRoot, ref.path);
      let actualPath;
      try {
        actualPath = realpathSync(candidate);
      } catch {
        blockers.push(`${gateName}: evidenceRefs[${index}] file does not exist: ${ref.path}`);
        return;
      }

      if (pathEscapesRoot(evidenceRoot, actualPath)) {
        blockers.push(`${gateName}: evidenceRefs[${index}] escapes the manifest evidence root.`);
        return;
      }

      let metadata;
      try {
        metadata = lstatSync(actualPath);
      } catch {
        blockers.push(`${gateName}: evidenceRefs[${index}] cannot be inspected: ${ref.path}`);
        return;
      }
      if (!metadata.isFile()) {
        blockers.push(`${gateName}: evidenceRefs[${index}] is not a regular file: ${ref.path}`);
        return;
      }

      const actualDigest = sha256File(actualPath);
      if (actualDigest !== ref.sha256) {
        blockers.push(
          `${gateName}: evidenceRefs[${index}] SHA-256 mismatch for ${ref.path}; expected ${ref.sha256}, got ${actualDigest}.`,
        );
      }
    });
  }

  return blockers;
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

function hashCommand(manifestPath, evidencePath) {
  if (!manifestPath || !evidencePath) {
    throw new Error('hash requires a manifest path and an evidence file path.');
  }
  console.log(JSON.stringify(createEvidenceRef(manifestPath, evidencePath)));
}

function reviewFieldCommand(
  manifestInputPath,
  gateName,
  evidenceInputPath,
  reviewer,
  reviewedAt,
  notes = '',
) {
  if (!manifestInputPath || !gateName || !evidenceInputPath || !reviewer || !reviewedAt) {
    throw new Error(
      'review-field requires <manifest.json> <gate> <evidence-file> <reviewer> <reviewedAt> [notes].',
    );
  }

  const manifestPath = resolve(manifestInputPath);
  const evidencePath = resolve(evidenceInputPath);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const report = JSON.parse(readFileSync(evidencePath, 'utf8'));
  const evidenceRef = createEvidenceRef(manifestPath, evidencePath);

  applyReviewedFieldEvidence({
    manifest,
    gateName,
    evidenceRef,
    report,
    reviewer,
    reviewedAt,
    notes,
  });

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  console.log(`Reviewed field evidence attached: gate=${gateName} path=${evidenceRef.path}`);
  console.log(
    'This records an explicit human review only. The overall pilot remains blocked until every required gate validates PASS.',
  );
}

function validateCommand(inputPath) {
  if (!inputPath) throw new Error('validate requires a manifest path.');
  const manifestPath = resolve(inputPath);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const structural = validateManifest(manifest, configuredReleaseCommit());
  const evidenceBlockers = validateEvidenceFiles(manifest, manifestPath);
  const result = {
    ok: structural.ok && evidenceBlockers.length === 0,
    blockers: [...structural.blockers, ...evidenceBlockers],
  };
  printValidation(result);
  if (!result.ok) process.exitCode = 1;
}

function usage() {
  console.log('Usage:');
  console.log('  node scripts/pilot-evidence.mjs init [output.json]');
  console.log('  node scripts/pilot-evidence.mjs hash <manifest.json> <evidence-file>');
  console.log(
    '  node scripts/pilot-evidence.mjs review-field <manifest.json> <gate> <evidence-file> <reviewer> <reviewedAt> [notes]',
  );
  console.log('  node scripts/pilot-evidence.mjs validate <manifest.json>');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const command = process.argv[2];
    if (command === 'init') initCommand(process.argv[3]);
    else if (command === 'hash') hashCommand(process.argv[3], process.argv[4]);
    else if (command === 'review-field') {
      reviewFieldCommand(
        process.argv[3],
        process.argv[4],
        process.argv[5],
        process.argv[6],
        process.argv[7],
        process.argv[8],
      );
    } else if (command === 'validate') validateCommand(process.argv[3]);
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
