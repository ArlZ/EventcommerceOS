import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  REQUIRED_GATES,
  REQUIRED_OWNERS,
  applyReviewedFieldEvidence,
  createEvidenceRef,
  createInitialManifest,
  validateEvidenceFiles,
  validateEvidenceRef,
  validateManifest,
} from './pilot-evidence.mjs';

const RELEASE = '1111111111111111111111111111111111111111';
const OTHER_RELEASE = '2222222222222222222222222222222222222222';
const REVIEWED_AT = '2026-08-15T12:00:00Z';
const PLACEHOLDER_DIGEST = '0'.repeat(64);

function evidenceRef(gateName, sha256 = PLACEHOLDER_DIGEST) {
  return { path: `evidence/${gateName}.json`, sha256 };
}

function completeManifest() {
  const manifest = createInitialManifest(RELEASE, '2026-08-15T11:00:00Z');
  manifest.pilot = {
    eventName: 'Controlled pilot',
    eventDate: '2026-08-20',
    venue: 'Test venue',
    deploymentMode: 'single_instance_pilot',
  };

  for (const owner of REQUIRED_OWNERS) manifest.owners[owner] = `Named ${owner}`;

  for (const gateName of REQUIRED_GATES) {
    manifest.gates[gateName] = {
      ...manifest.gates[gateName],
      status: 'PASS',
      evidenceRefs: [evidenceRef(gateName)],
      reviewer: 'Named reviewer',
      reviewedAt: REVIEWED_AT,
    };
  }

  manifest.gates.representativeRecovery.representativeData = true;
  manifest.gates.dependencySecurity.blockingFindings = 0;
  return manifest;
}

function digest(content) {
  return createHash('sha256').update(content).digest('hex');
}

function createEvidenceFixture() {
  const root = mkdtempSync(join(tmpdir(), 'event-commerce-evidence-'));
  const manifestPath = join(root, 'pilot-evidence.json');
  const manifest = completeManifest();

  for (const gateName of REQUIRED_GATES) {
    const content = `${gateName}-evidence\n`;
    const ref = evidenceRef(gateName, digest(content));
    const absolute = join(root, ref.path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
    manifest.gates[gateName].evidenceRefs = [ref];
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return { root, manifestPath, manifest };
}

test('new manifest is blocked and never starts as a pass', () => {
  const manifest = createInitialManifest(RELEASE, '2026-08-15T11:00:00Z');
  assert.equal(manifest.schemaVersion, 2);
  const result = validateManifest(manifest, RELEASE);
  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((blocker) => blocker.includes('status is NOT_RUN')));
});

test('complete evidence manifest passes structural validation', () => {
  const result = validateManifest(completeManifest(), RELEASE);
  assert.deepEqual(result, { ok: true, blockers: [] });
});

test('release commit mismatch fails closed', () => {
  const result = validateManifest(completeManifest(), OTHER_RELEASE);
  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((blocker) => blocker.includes('does not match expected release')));
});

test('unknown deployment mode fails closed', () => {
  const manifest = completeManifest();
  manifest.pilot.deploymentMode = 'production';
  const result = validateManifest(manifest, RELEASE);
  assert.equal(result.ok, false);
  assert.ok(
    result.blockers.some((blocker) =>
      blocker.includes('single_instance_pilot or upstream_distributed'),
    ),
  );
});

test('pass without evidence and named review fails', () => {
  const manifest = completeManifest();
  manifest.gates.hardwareNetwork.evidenceRefs = [];
  manifest.gates.hardwareNetwork.reviewer = '';
  manifest.gates.hardwareNetwork.reviewedAt = '';
  const result = validateManifest(manifest, RELEASE);
  assert.equal(result.ok, false);
  assert.ok(
    result.blockers.some((blocker) =>
      blocker.includes('hardwareNetwork: PASS requires at least one'),
    ),
  );
  assert.ok(
    result.blockers.some((blocker) =>
      blocker.includes('hardwareNetwork: PASS requires a named reviewer'),
    ),
  );
});

test('legacy string evidence references are rejected', () => {
  const manifest = completeManifest();
  manifest.gates.hardwareNetwork.evidenceRefs = ['evidence/hardware.json'];
  const result = validateManifest(manifest, RELEASE);
  assert.equal(result.ok, false);
  assert.ok(
    result.blockers.some((blocker) =>
      blocker.includes('evidence reference must be an object with path and sha256'),
    ),
  );
});

test('evidence reference requires safe relative path and lowercase SHA-256', () => {
  assert.deepEqual(validateEvidenceRef({ path: '../outside.json', sha256: 'A'.repeat(64) }), [
    'evidence path must be a safe relative path without . or .. segments.',
    'evidence sha256 must be a lowercase 64-character SHA-256 digest.',
  ]);
});

test('synthetic recovery cannot satisfy representative recovery gate', () => {
  const manifest = completeManifest();
  manifest.gates.representativeRecovery.representativeData = false;
  const result = validateManifest(manifest, RELEASE);
  assert.equal(result.ok, false);
  assert.ok(
    result.blockers.some((blocker) => blocker.includes('synthetic CI recovery is insufficient')),
  );
});

test('dependency security cannot pass with blockers', () => {
  const manifest = completeManifest();
  manifest.gates.dependencySecurity.blockingFindings = 1;
  const result = validateManifest(manifest, RELEASE);
  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((blocker) => blocker.includes('blockingFindings=0')));
});

test('hash helper creates a digest-bound reference relative to the manifest', () => {
  const fixture = createEvidenceFixture();
  try {
    const file = join(fixture.root, 'evidence', 'hardwareNetwork.json');
    assert.deepEqual(createEvidenceRef(fixture.manifestPath, file), {
      path: 'evidence/hardwareNetwork.json',
      sha256: digest('hardwareNetwork-evidence\n'),
    });
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('hash helper refuses evidence outside the manifest directory', () => {
  const fixture = createEvidenceFixture();
  const outsideRoot = mkdtempSync(join(tmpdir(), 'event-commerce-outside-'));
  const outsideFile = join(outsideRoot, 'outside.txt');
  writeFileSync(outsideFile, 'outside\n');
  try {
    assert.throws(
      () => createEvidenceRef(fixture.manifestPath, outsideFile),
      /must be retained under the manifest directory/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test('retained evidence files pass when every digest matches', () => {
  const fixture = createEvidenceFixture();
  try {
    assert.deepEqual(validateEvidenceFiles(fixture.manifest, fixture.manifestPath), []);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('retained evidence fails when reviewed bytes change', () => {
  const fixture = createEvidenceFixture();
  try {
    const ref = fixture.manifest.gates.hardwareNetwork.evidenceRefs[0];
    writeFileSync(join(fixture.root, ref.path), 'tampered-after-review\n');
    const blockers = validateEvidenceFiles(fixture.manifest, fixture.manifestPath);
    assert.ok(blockers.some((blocker) => blocker.includes('SHA-256 mismatch')));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('retained evidence fails when a referenced file is missing', () => {
  const fixture = createEvidenceFixture();
  try {
    const ref = fixture.manifest.gates.hardwareNetwork.evidenceRefs[0];
    rmSync(join(fixture.root, ref.path));
    const blockers = validateEvidenceFiles(fixture.manifest, fixture.manifestPath);
    assert.ok(blockers.some((blocker) => blocker.includes('file does not exist')));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('retained evidence fails when the reference resolves to a directory', () => {
  const fixture = createEvidenceFixture();
  try {
    fixture.manifest.gates.hardwareNetwork.evidenceRefs = [
      { path: 'evidence', sha256: PLACEHOLDER_DIGEST },
    ];
    const blockers = validateEvidenceFiles(fixture.manifest, fixture.manifestPath);
    assert.ok(blockers.some((blocker) => blocker.includes('is not a regular file')));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});


test('review helper attaches a verified hardware/network report with named review', () => {
  const manifest = createInitialManifest(RELEASE, '2026-08-15T11:00:00Z');
  const ref = evidenceRef('hardwareNetwork');
  const report = {
    releaseCommit: RELEASE,
    status: 'PASS',
    hardwareNetworkSatisfied: true,
    liveMoneyApproved: false,
  };
  applyReviewedFieldEvidence({
    manifest,
    gateName: 'hardwareNetwork',
    evidenceRef: ref,
    report,
    reviewer: 'Named reviewer',
    reviewedAt: REVIEWED_AT,
    notes: 'Venue field exercise reviewed.',
  });
  assert.equal(manifest.gates.hardwareNetwork.status, 'PASS');
  assert.deepEqual(manifest.gates.hardwareNetwork.evidenceRefs, [ref]);
  assert.equal(manifest.gates.hardwareNetwork.reviewer, 'Named reviewer');
  assert.equal(manifest.gates.hardwareNetwork.reviewedAt, REVIEWED_AT);
});

test('review helper sets representativeData only for a passing representative recovery report', () => {
  const manifest = createInitialManifest(RELEASE, '2026-08-15T11:00:00Z');
  applyReviewedFieldEvidence({
    manifest,
    gateName: 'representativeRecovery',
    evidenceRef: evidenceRef('representativeRecovery'),
    report: {
      releaseCommit: RELEASE,
      status: 'PASS',
      representativeRecoverySatisfied: true,
      liveMoneyApproved: false,
    },
    reviewer: 'Recovery reviewer',
    reviewedAt: REVIEWED_AT,
  });
  assert.equal(manifest.gates.representativeRecovery.status, 'PASS');
  assert.equal(manifest.gates.representativeRecovery.representativeData, true);
});

test('review helper accepts event-close report for each close gate without inventing status', () => {
  const manifest = createInitialManifest(RELEASE, '2026-08-15T11:00:00Z');
  const report = {
    releaseCommit: RELEASE,
    controlledPilotCloseSatisfied: true,
    inventoryCloseReconciliationSatisfied: true,
    liveMoneyApproved: false,
  };
  for (const gateName of ['inventoryCloseReconciliation', 'controlledPilotClose']) {
    applyReviewedFieldEvidence({
      manifest,
      gateName,
      evidenceRef: evidenceRef(gateName),
      report,
      reviewer: 'Close reviewer',
      reviewedAt: REVIEWED_AT,
    });
    assert.equal(manifest.gates[gateName].status, 'PASS');
  }
});

test('review helper fails closed for release mismatch or missing safe boundary', () => {
  const manifest = createInitialManifest(RELEASE, '2026-08-15T11:00:00Z');
  const ref = evidenceRef('paymentFaultMatrix');
  assert.throws(
    () =>
      applyReviewedFieldEvidence({
        manifest,
        gateName: 'paymentFaultMatrix',
        evidenceRef: ref,
        report: {
          releaseCommit: OTHER_RELEASE,
          status: 'PASS',
          paymentFaultMatrixSatisfied: true,
          liveMoneyApproved: false,
        },
        reviewer: 'Finance reviewer',
        reviewedAt: REVIEWED_AT,
      }),
    /releaseCommit must match/,
  );
  assert.throws(
    () =>
      applyReviewedFieldEvidence({
        manifest,
        gateName: 'paymentFaultMatrix',
        evidenceRef: ref,
        report: {
          releaseCommit: RELEASE,
          status: 'PASS',
          paymentFaultMatrixSatisfied: true,
          liveMoneyApproved: true,
        },
        reviewer: 'Finance reviewer',
        reviewedAt: REVIEWED_AT,
      }),
    /liveMoneyApproved=false/,
  );
});

test('review helper rejects unsupported automated review for governance gates', () => {
  const manifest = createInitialManifest(RELEASE, '2026-08-15T11:00:00Z');
  assert.throws(
    () =>
      applyReviewedFieldEvidence({
        manifest,
        gateName: 'branchProtection',
        evidenceRef: evidenceRef('branchProtection'),
        report: { releaseCommit: RELEASE, liveMoneyApproved: false },
        reviewer: 'Security reviewer',
        reviewedAt: REVIEWED_AT,
      }),
    /not supported by field-evidence review/,
  );
});

test('review helper does not duplicate the same digest-bound evidence reference', () => {
  const manifest = createInitialManifest(RELEASE, '2026-08-15T11:00:00Z');
  const ref = evidenceRef('offlineDurability');
  const report = {
    releaseCommit: RELEASE,
    status: 'PASS',
    gateBSatisfied: true,
    liveMoneyApproved: false,
  };
  for (let index = 0; index < 2; index += 1) {
    applyReviewedFieldEvidence({
      manifest,
      gateName: 'offlineDurability',
      evidenceRef: ref,
      report,
      reviewer: 'Durability reviewer',
      reviewedAt: REVIEWED_AT,
    });
  }
  assert.deepEqual(manifest.gates.offlineDurability.evidenceRefs, [ref]);
});
