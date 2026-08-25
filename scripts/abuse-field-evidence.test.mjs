import assert from 'node:assert/strict';
import test from 'node:test';
import { runAbuseProbe, normalizeProbeConfig } from './http-abuse-probe.mjs';
import { verifyAbuseFieldEvidence } from './abuse-field-evidence.mjs';

const releaseCommit = 'a'.repeat(40);
const eventId = 'event-1';

function observation(
  targetRole,
  {
    startedAt = '2026-08-25T10:00:00.000Z',
    completedAt = '2026-08-25T10:10:00.000Z',
    rateLimitedCount = 1,
    successCount = 10,
    policies = [],
    concurrencyLimits = [],
    authConcurrencyLimits = [],
    recoveryStatus = 200,
  } = {},
) {
  return {
    schemaVersion: 1,
    releaseCommit,
    scenarioId: `scenario-${targetRole.toLowerCase()}`,
    targetRole,
    environment: 'controlled-pilot',
    target: 'https://example.test/path',
    startedAt,
    completedAt,
    durationMs: Date.parse(completedAt) - Date.parse(startedAt),
    requestCount: rateLimitedCount + successCount,
    concurrency: 10,
    statusCounts: { 200: successCount, 429: rateLimitedCount },
    successCount,
    rateLimitedCount,
    transportErrorCount: 0,
    observedRateLimitPolicies: policies,
    observedConcurrencyLimits: concurrencyLimits,
    observedAuthConcurrencyLimits: authConcurrencyLimits,
    retryAfterSeconds: rateLimitedCount ? [1] : [],
    recovery: {
      attempted: true,
      delayMs: 1250,
      status: recoveryStatus,
      errorCode: null,
    },
    liveMoneyApproved: false,
  };
}

function fixture() {
  return {
    manifest: { schemaVersion: 1, releaseCommit, eventId },
    cloudPublicBurst: observation('CLOUD_PUBLIC', { policies: ['PUBLIC'] }),
    cloudConcurrency: observation('CLOUD_CONCURRENCY', { concurrencyLimits: [64] }),
    operatorReadBurst: observation('CLOUD_OPERATOR_READ', { policies: ['OPERATOR_READ'] }),
    edgeRunaway: observation('EDGE_DEVICE_SYNC', {
      startedAt: '2026-08-25T10:01:00.000Z',
      completedAt: '2026-08-25T10:08:00.000Z',
      policies: ['DEVICE_SYNC'],
    }),
    edgeHealthyPeer: observation('EDGE_DEVICE_SYNC', {
      startedAt: '2026-08-25T10:02:00.000Z',
      completedAt: '2026-08-25T10:05:00.000Z',
      rateLimitedCount: 0,
      successCount: 5,
      policies: [],
    }),
    providerCallbackBurst: observation('PROVIDER_CALLBACK', {
      policies: ['PROVIDER_CALLBACK'],
    }),
    paymentFaultMatrixReport: {
      schemaVersion: 1,
      releaseCommit,
      eventId,
      status: 'PASS',
      liveMoneyApproved: false,
    },
  };
}

test('bounded probe rejects production targets and insecure remote HTTP', () => {
  const base = {
    schemaVersion: 1,
    releaseCommit,
    scenarioId: 'public-burst',
    targetRole: 'CLOUD_PUBLIC',
    environment: 'controlled-pilot',
    targetOwnershipAcknowledged: true,
    url: 'https://example.test/health',
  };
  assert.throws(() => normalizeProbeConfig({ ...base, environment: 'production' }), /environment/);
  assert.throws(
    () => normalizeProbeConfig({ ...base, url: 'http://example.test/health' }),
    /HTTPS/,
  );
});

test('bounded probe uses secret headers but never serializes them into evidence', async () => {
  process.env.ABUSE_TEST_AUTH = 'Bearer secret-that-must-not-be-retained';
  const seen = [];
  let calls = 0;
  const fetchImpl = async (_url, options) => {
    seen.push(options.headers.Authorization);
    calls += 1;
    return new Response('', {
      status: calls === 1 ? 429 : 200,
      headers: calls === 1 ? { 'Retry-After': '1', 'X-RateLimit-Policy': 'PUBLIC' } : {},
    });
  };
  try {
    const report = await runAbuseProbe(
      {
        schemaVersion: 1,
        releaseCommit,
        scenarioId: 'public-burst',
        targetRole: 'CLOUD_PUBLIC',
        environment: 'controlled-pilot',
        targetOwnershipAcknowledged: true,
        url: 'https://example.test/health?do-not-retain=query',
        totalRequests: 2,
        concurrency: 1,
        recovery: false,
        headersFromEnv: { Authorization: 'ABUSE_TEST_AUTH' },
      },
      { fetchImpl },
    );
    assert.deepEqual(seen, [process.env.ABUSE_TEST_AUTH, process.env.ABUSE_TEST_AUTH]);
    assert.equal(report.rateLimitedCount, 1);
    assert.equal(report.target, 'https://example.test/health');
    assert.equal(JSON.stringify(report).includes('secret-that-must-not-be-retained'), false);
    assert.equal(JSON.stringify(report).includes('do-not-retain'), false);
  } finally {
    delete process.env.ABUSE_TEST_AUTH;
  }
});

test('abuse field evidence passes only when every bounded field proof is green', () => {
  const report = verifyAbuseFieldEvidence(fixture());
  assert.equal(report.status, 'PASS');
  assert.equal(report.abuseGateSatisfied, true);
  assert.equal(report.liveMoneyApproved, false);
  assert.match(report.reportDigestSha256, /^[0-9a-f]{64}$/);
});

test('abuse field evidence fails if the healthy Edge peer is also throttled', () => {
  const input = fixture();
  input.edgeHealthyPeer.rateLimitedCount = 1;
  input.edgeHealthyPeer.statusCounts['429'] = 1;
  const report = verifyAbuseFieldEvidence(input);
  assert.equal(report.status, 'FAIL');
  assert.equal(
    report.checks.find((entry) => entry.id === 'edge:healthy-peer-continues')?.status,
    'FAIL',
  );
});

test('abuse field evidence fails if peer traffic did not overlap the Cloud flood', () => {
  const input = fixture();
  input.edgeHealthyPeer.startedAt = '2026-08-25T11:00:00.000Z';
  input.edgeHealthyPeer.completedAt = '2026-08-25T11:05:00.000Z';
  const report = verifyAbuseFieldEvidence(input);
  assert.equal(report.status, 'FAIL');
  assert.equal(
    report.checks.find((entry) => entry.id === 'offline-boundary:edge-peer-overlaps-cloud-flood')
      ?.status,
    'FAIL',
  );
});

test('abuse field evidence fails while payment truth under faults is unresolved', () => {
  const input = fixture();
  input.paymentFaultMatrixReport.status = 'FAIL';
  const report = verifyAbuseFieldEvidence(input);
  assert.equal(report.status, 'FAIL');
  assert.equal(
    report.checks.find((entry) => entry.id === 'payment:throttling-preserves-truth')?.status,
    'FAIL',
  );
});

test('abuse field evidence fails closed on exact-release mismatch', () => {
  const input = fixture();
  input.providerCallbackBurst.releaseCommit = 'b'.repeat(40);
  const report = verifyAbuseFieldEvidence(input);
  assert.equal(report.status, 'FAIL');
  assert.equal(
    report.checks.find((entry) => entry.id === 'observation:providerCallbackBurst:schema')?.status,
    'FAIL',
  );
});
