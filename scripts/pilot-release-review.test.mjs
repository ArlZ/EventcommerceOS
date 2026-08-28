import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { REQUIRED_GATES, REQUIRED_OWNERS, createInitialManifest } from './pilot-evidence.mjs';
import { runPilotReleaseReview } from './pilot-release-review.mjs';

const RELEASE = '3'.repeat(40);
const REVIEWED_AT = '2026-08-27T11:00:00+03:00';

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'event-commerce-release-review-'));
  const manifestPath = join(root, 'pilot-evidence.json');
  const manifest = createInitialManifest(RELEASE, '2026-08-27T10:00:00+03:00');
  manifest.pilot = {
    eventName: 'Controlled pilot',
    eventDate: '2026-08-27',
    venue: 'Controlled venue',
    deploymentMode: 'single_instance_pilot',
  };
  for (const owner of REQUIRED_OWNERS) manifest.owners[owner] = `Named ${owner}`;

  for (const gateName of REQUIRED_GATES) {
    const content = `${gateName}-reviewed-evidence\n`;
    const relativePath = `evidence/${gateName}.json`;
    const absolutePath = join(root, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
    manifest.gates[gateName] = {
      ...manifest.gates[gateName],
      status: 'PASS',
      evidenceRefs: [{ path: relativePath, sha256: sha256(content) }],
      reviewer: 'Named reviewer',
      reviewedAt: REVIEWED_AT,
    };
  }
  manifest.gates.representativeRecovery.representativeData = true;
  manifest.gates.dependencySecurity.blockingFindings = 0;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return { root, manifestPath, manifest };
}

function environment() {
  return {
    PILOT_PREFLIGHT_RELEASE_COMMIT: RELEASE,
    ABUSE_DEPLOYMENT_MODE: 'single_instance_pilot',
    ABUSE_UPSTREAM_CONFIRMED: 'false',
    TRUST_PROXY_HOPS: '0',
    CLOUD_HEALTH_URL: 'https://cloud.example.test/health',
    EDGE_HEALTH_URL: 'https://edge.example.test/health',
    CONTROL_HEALTH_URL: 'https://control.example.test/health',
  };
}

function healthyFetch(url) {
  const service = String(url).includes('cloud.')
    ? 'cloud-api'
    : String(url).includes('edge.')
      ? 'event-edge'
      : 'control-web';
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => ({ service, status: 'ok', releaseCommit: RELEASE }),
  });
}

function gitIdentity() {
  return {
    releaseCommit: RELEASE,
    releaseTree: '4'.repeat(40),
    trackedWorktreeClean: true,
  };
}

test('release review becomes ready only when all gates, bytes and runtimes pass', async () => {
  const data = fixture();
  try {
    const report = await runPilotReleaseReview({
      manifest: data.manifest,
      manifestPath: data.manifestPath,
      gitIdentity: gitIdentity(),
      env: environment(),
      fetchImpl: healthyFetch,
      now: new Date('2026-08-27T11:30:00+03:00'),
    });

    assert.equal(report.status, 'READY_FOR_HUMAN_GO_NO_GO');
    assert.equal(report.candidateReadyForHumanGoNoGo, true);
    assert.equal(report.liveMoneyApproved, false);
    assert.ok(report.checks.every((entry) => entry.status === 'PASS'));
    assert.match(report.reportDigestSha256, /^[0-9a-f]{64}$/);
  } finally {
    rmSync(data.root, { recursive: true, force: true });
  }
});

test('release review blocks when reviewed evidence bytes have changed', async () => {
  const data = fixture();
  try {
    writeFileSync(join(data.root, 'evidence', 'hardwareNetwork.json'), 'tampered\n');
    const report = await runPilotReleaseReview({
      manifest: data.manifest,
      manifestPath: data.manifestPath,
      gitIdentity: gitIdentity(),
      env: environment(),
      fetchImpl: healthyFetch,
    });

    assert.equal(report.status, 'BLOCKED');
    assert.equal(report.candidateReadyForHumanGoNoGo, false);
    assert.equal(
      report.checks.find((entry) => entry.id === 'manifest:evidence-bytes')?.status,
      'BLOCKED',
    );
  } finally {
    rmSync(data.root, { recursive: true, force: true });
  }
});

test('release review blocks when a runtime reports a different release', async () => {
  const data = fixture();
  try {
    const fetchImpl = async (url) => {
      const response = await healthyFetch(url);
      if (String(url).includes('edge.')) {
        return {
          ...response,
          json: async () => ({
            service: 'event-edge',
            status: 'ok',
            releaseCommit: '5'.repeat(40),
          }),
        };
      }
      return response;
    };

    const report = await runPilotReleaseReview({
      manifest: data.manifest,
      manifestPath: data.manifestPath,
      gitIdentity: gitIdentity(),
      env: environment(),
      fetchImpl,
    });

    assert.equal(report.status, 'BLOCKED');
    assert.equal(
      report.checks.find((entry) => entry.id === 'preflight:release-and-runtime')?.status,
      'BLOCKED',
    );
  } finally {
    rmSync(data.root, { recursive: true, force: true });
  }
});

test(
  'release review never authorizes live money even when machine prerequisites pass',
  async () => {
    const data = fixture();
    try {
      const report = await runPilotReleaseReview({
        manifest: data.manifest,
        manifestPath: data.manifestPath,
        gitIdentity: gitIdentity(),
        env: environment(),
        fetchImpl: healthyFetch,
      });
      assert.equal(report.candidateReadyForHumanGoNoGo, true);
      assert.equal(report.liveMoneyApproved, false);
      assert.match(report.scope, /does not itself authorize live money/);
    } finally {
      rmSync(data.root, { recursive: true, force: true });
    }
  },
);
