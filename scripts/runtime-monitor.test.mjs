import assert from 'node:assert/strict';
import test from 'node:test';
import { renderPrometheus, runRuntimeMonitor, runtimeMonitorConfig } from './runtime-monitor.mjs';

const RELEASE = 'a'.repeat(40);

function configEnvironment(overrides = {}) {
  return {
    RUNTIME_MONITOR_EXPECTED_RELEASE: RELEASE,
    RUNTIME_MONITOR_CLOUD_URL: 'https://cloud.example.test/health',
    RUNTIME_MONITOR_EDGE_URL: 'https://edge.example.test/health',
    RUNTIME_MONITOR_CONTROL_URL: 'https://control.example.test/api/health',
    ...overrides,
  };
}

function healthyFetch(overrides = {}) {
  return async (url) => {
    const service = url.includes('cloud')
      ? 'cloud-api'
      : url.includes('edge')
        ? 'event-edge'
        : 'control-web';
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          service,
          status: 'ok',
          releaseCommit: service === 'control-web' ? null : RELEASE,
          ...overrides[service],
        };
      },
    };
  };
}

function deterministicNow() {
  let value = 0;
  return () => {
    value += 25;
    return value;
  };
}

test('runtime monitor passes healthy exact-release services', async () => {
  const config = runtimeMonitorConfig(configEnvironment());
  const report = await runRuntimeMonitor({
    config,
    fetchImpl: healthyFetch(),
    now: deterministicNow(),
    generatedAt: new Date('2026-08-15T20:00:00.000Z'),
  });

  assert.equal(report.status, 'PASS');
  assert.equal(report.expectedRelease, RELEASE);
  assert.deepEqual(
    report.results.map((result) => [result.service, result.up, result.releaseMatch]),
    [
      ['cloud-api', true, true],
      ['event-edge', true, true],
      ['control-web', true, null],
    ],
  );
  assert.equal(
    report.results.every((result) => result.durationMs === 25),
    true,
  );
});

test('runtime monitor blocks a backend release mismatch', async () => {
  const config = runtimeMonitorConfig(configEnvironment());
  const report = await runRuntimeMonitor({
    config,
    fetchImpl: healthyFetch({ 'event-edge': { releaseCommit: 'b'.repeat(40) } }),
    now: deterministicNow(),
  });

  assert.equal(report.status, 'BLOCKED');
  const edge = report.results.find((result) => result.service === 'event-edge');
  assert.equal(edge.up, false);
  assert.equal(edge.releaseMatch, false);
  assert.equal(edge.reason, 'RELEASE_MISMATCH');
});

test('runtime monitor normalizes fetch failures without retaining error detail', async () => {
  const config = runtimeMonitorConfig(configEnvironment());
  const report = await runRuntimeMonitor({
    config,
    fetchImpl: async () => {
      throw new Error('secret provider detail should not escape');
    },
    now: deterministicNow(),
  });

  assert.equal(report.status, 'BLOCKED');
  assert.equal(
    report.results.every((result) => result.reason === 'FETCH_FAILED'),
    true,
  );
  assert.equal(JSON.stringify(report).includes('secret provider detail'), false);
});

test('runtime monitor rejects unsafe or incomplete configuration', () => {
  assert.throws(
    () => runtimeMonitorConfig(configEnvironment({ RUNTIME_MONITOR_EXPECTED_RELEASE: 'short' })),
    /40-character Git SHA/,
  );
  assert.throws(
    () =>
      runtimeMonitorConfig(
        configEnvironment({ RUNTIME_MONITOR_CLOUD_URL: 'http://cloud.example.test/health' }),
      ),
    /must use HTTPS/,
  );
  assert.throws(
    () =>
      runtimeMonitorConfig(
        configEnvironment({
          RUNTIME_MONITOR_EDGE_URL: 'https://user:secret@edge.example.test/health',
        }),
      ),
    /must not contain credentials/,
  );
  assert.throws(
    () =>
      runtimeMonitorConfig(
        configEnvironment({
          RUNTIME_MONITOR_CONTROL_URL: 'https://control.example.test/api/health?token=x',
        }),
      ),
    /query parameters/,
  );
  assert.throws(
    () => runtimeMonitorConfig(configEnvironment({ RUNTIME_MONITOR_TIMEOUT_MS: '999' })),
    /between 1000 and 15000/,
  );
});

test('runtime monitor accepts localhost HTTP for synthetic checks', () => {
  const config = runtimeMonitorConfig(
    configEnvironment({
      RUNTIME_MONITOR_CLOUD_URL: 'http://127.0.0.1:3001/health',
      RUNTIME_MONITOR_EDGE_URL: 'http://localhost:3002/health',
      RUNTIME_MONITOR_CONTROL_URL: 'http://127.0.0.1:3000/api/health',
    }),
  );
  assert.equal(config.timeoutMs, 5_000);
});

test('Prometheus output uses only bounded service labels and no endpoints', async () => {
  const config = runtimeMonitorConfig(configEnvironment());
  const report = await runRuntimeMonitor({
    config,
    fetchImpl: healthyFetch(),
    now: deterministicNow(),
  });
  const output = renderPrometheus(report);

  assert.match(output, /event_commerce_runtime_probe_up\{service="cloud-api"\} 1/);
  assert.match(output, /event_commerce_runtime_release_match\{service="event-edge"\} 1/);
  assert.equal(output.includes('example.test'), false);
  assert.equal(output.includes(RELEASE), false);
  assert.equal(output.includes('reason='), false);
});
