import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialManifest } from './pilot-evidence.mjs';
import {
  runPreflight,
  validateDeploymentConfig,
  validatePilotManifestReadiness,
} from './pilot-preflight.mjs';

const RELEASE = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const DIGEST = '0'.repeat(64);

function readyManifest() {
  const manifest = createInitialManifest(RELEASE, '2026-08-15T16:00:00.000Z');
  manifest.pilot = {
    eventName: 'Controlled pilot',
    eventDate: '2026-08-20',
    venue: 'Pilot venue',
    deploymentMode: 'single_instance_pilot',
  };
  manifest.owners = {
    eventOperationsLead: 'Event Ops Reviewer',
    technicalIncidentLead: 'Technical Reviewer',
    financeReconciliationOwner: 'Finance Reviewer',
    inventoryOwner: 'Inventory Reviewer',
    securityReleaseReviewer: 'Security Reviewer',
  };
  return manifest;
}

function baseEnv() {
  return {
    ABUSE_DEPLOYMENT_MODE: 'single_instance_pilot',
    ABUSE_UPSTREAM_CONFIRMED: 'false',
    TRUST_PROXY_HOPS: '0',
    CLOUD_HEALTH_URL: 'https://cloud.example.test/health',
    EDGE_HEALTH_URL: 'https://edge.example.test/health',
  };
}

function gitIdentity() {
  return {
    releaseCommit: RELEASE,
    releaseTree: TREE,
    trackedWorktreeClean: true,
  };
}

function healthyFetch(overrides = {}) {
  return async (url) => {
    const service = url.includes('cloud') ? 'cloud-api' : 'event-edge';
    const body = {
      service,
      status: 'ok',
      version: '0.1.0',
      releaseCommit: RELEASE,
      timestamp: '2026-08-15T16:00:00.000Z',
      ...overrides[service],
    };
    return {
      ok: true,
      status: 200,
      async json() {
        return body;
      },
    };
  };
}

test('preflight passes only readiness checks and never claims field evidence', async () => {
  const report = await runPreflight({
    env: baseEnv(),
    manifest: readyManifest(),
    gitIdentity: gitIdentity(),
    fetchImpl: healthyFetch(),
    now: new Date('2026-08-15T16:30:00.000Z'),
  });

  assert.equal(report.status, 'PASS');
  assert.equal(report.releaseCommit, RELEASE);
  assert.equal(report.releaseTree, TREE);
  assert.equal(report.fieldEvidenceSatisfied, false);
  assert.match(report.reportDigestSha256, /^[0-9a-f]{64}$/);
  assert.equal(
    report.checks.every((entry) => entry.status === 'PASS'),
    true,
  );
});

test('preflight blocks when a deployed service reports another release', async () => {
  const report = await runPreflight({
    env: baseEnv(),
    manifest: readyManifest(),
    gitIdentity: gitIdentity(),
    fetchImpl: healthyFetch({ 'event-edge': { releaseCommit: 'c'.repeat(40) } }),
  });

  assert.equal(report.status, 'BLOCKED');
  const edge = report.checks.find((entry) => entry.id === 'health:event-edge');
  assert.equal(edge.status, 'BLOCKED');
  assert.match(edge.details, /releaseCommit does not match/);
});

test('preflight rejects non-local plaintext health URLs', async () => {
  const env = baseEnv();
  env.CLOUD_HEALTH_URL = 'http://cloud.example.test/health';

  const report = await runPreflight({
    env,
    manifest: readyManifest(),
    gitIdentity: gitIdentity(),
    fetchImpl: healthyFetch(),
  });

  assert.equal(report.status, 'BLOCKED');
  const cloud = report.checks.find((entry) => entry.id === 'health:cloud-api');
  assert.match(cloud.details, /must use HTTPS/);
});

test('distributed deployment fails closed without upstream confirmation and trusted proxy', () => {
  const result = validateDeploymentConfig({
    ABUSE_DEPLOYMENT_MODE: 'upstream_distributed',
    ABUSE_UPSTREAM_CONFIRMED: 'false',
    TRUST_PROXY_HOPS: '0',
  });

  assert.equal(result.errors.length, 2);
  assert.match(result.errors.join(' '), /ABUSE_UPSTREAM_CONFIRMED=true/);
  assert.match(result.errors.join(' '), /TRUST_PROXY_HOPS>=1/);
});

test('manifest readiness requires named owners and accepts existing FAIL gate state', () => {
  const manifest = readyManifest();
  manifest.owners.inventoryOwner = '';
  manifest.gates.branchProtection.status = 'FAIL';

  const errors = validatePilotManifestReadiness(manifest, RELEASE, 'single_instance_pilot');

  assert.equal(
    errors.some((entry) => entry.includes('owners.inventoryOwner')),
    true,
  );
  assert.equal(
    errors.some((entry) => entry.includes('branchProtection.status')),
    false,
  );
});

test('manifest readiness rejects a claimed PASS without evidence and review', () => {
  const manifest = readyManifest();
  manifest.gates.hardwareNetwork.status = 'PASS';

  const errors = validatePilotManifestReadiness(manifest, RELEASE, 'single_instance_pilot');

  assert.equal(
    errors.some((entry) => entry.includes('hardwareNetwork is PASS without evidenceRefs')),
    true,
  );
  assert.equal(
    errors.some((entry) => entry.includes('hardwareNetwork is PASS without a named reviewer')),
    true,
  );
});

test('manifest readiness rejects legacy string evidence on a claimed PASS', () => {
  const manifest = readyManifest();
  manifest.gates.hardwareNetwork = {
    ...manifest.gates.hardwareNetwork,
    status: 'PASS',
    evidenceRefs: ['evidence/hardware.json'],
    reviewer: 'Hardware reviewer',
    reviewedAt: '2026-08-15T17:00:00Z',
  };

  const errors = validatePilotManifestReadiness(manifest, RELEASE, 'single_instance_pilot');
  assert.equal(
    errors.some((entry) =>
      entry.includes('evidence reference must be an object with path and sha256'),
    ),
    true,
  );
});

test('manifest readiness accepts digest-bound evidence on a claimed PASS', () => {
  const manifest = readyManifest();
  manifest.gates.hardwareNetwork = {
    ...manifest.gates.hardwareNetwork,
    status: 'PASS',
    evidenceRefs: [{ path: 'evidence/hardware.json', sha256: DIGEST }],
    reviewer: 'Hardware reviewer',
    reviewedAt: '2026-08-15T17:00:00Z',
  };

  const errors = validatePilotManifestReadiness(manifest, RELEASE, 'single_instance_pilot');
  assert.equal(
    errors.some((entry) => entry.includes('hardwareNetwork')),
    false,
  );
});

test('manifest readiness rejects the legacy schema before field validation', () => {
  const manifest = readyManifest();
  manifest.schemaVersion = 1;
  const errors = validatePilotManifestReadiness(manifest, RELEASE, 'single_instance_pilot');
  assert.equal(
    errors.some((entry) => entry.includes('schemaVersion must equal 2')),
    true,
  );
});

test('preflight report does not serialize unrelated secret environment values', async () => {
  const env = { ...baseEnv(), PAYMENT_PROVIDER_SECRET: 'do-not-retain-this-value' };
  const report = await runPreflight({
    env,
    manifest: readyManifest(),
    gitIdentity: gitIdentity(),
    fetchImpl: healthyFetch(),
  });

  assert.equal(JSON.stringify(report).includes('do-not-retain-this-value'), false);
});
