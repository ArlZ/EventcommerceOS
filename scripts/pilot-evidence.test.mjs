import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REQUIRED_GATES,
  REQUIRED_OWNERS,
  createInitialManifest,
  validateManifest,
} from './pilot-evidence.mjs';

const RELEASE = '1111111111111111111111111111111111111111';
const OTHER_RELEASE = '2222222222222222222222222222222222222222';
const REVIEWED_AT = '2026-08-15T12:00:00Z';

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
      evidenceRefs: [`evidence/${gateName}.json`],
      reviewer: 'Named reviewer',
      reviewedAt: REVIEWED_AT,
    };
  }

  manifest.gates.representativeRecovery.representativeData = true;
  manifest.gates.dependencySecurity.blockingFindings = 0;
  return manifest;
}

test('new manifest is blocked and never starts as a pass', () => {
  const manifest = createInitialManifest(RELEASE, '2026-08-15T11:00:00Z');
  const result = validateManifest(manifest, RELEASE);
  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((blocker) => blocker.includes('status is NOT_RUN')));
});

test('complete evidence manifest passes', () => {
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
