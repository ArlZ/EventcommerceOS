import { fileURLToPath } from 'node:url';

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const SERVICE_NAMES = ['cloud-api', 'event-edge', 'control-web'];

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function safeProbeUrl(rawValue, label) {
  if (!nonEmptyString(rawValue)) {
    return { error: `${label} is required` };
  }

  let parsed;
  try {
    parsed = new URL(rawValue);
  } catch {
    return { error: `${label} must be a valid URL` };
  }

  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    return { error: `${label} must not contain credentials, query parameters, or fragments` };
  }

  const isLocal = LOCAL_HOSTS.has(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(isLocal && parsed.protocol === 'http:')) {
    return { error: `${label} must use HTTPS unless it targets localhost` };
  }

  return { url: parsed.toString() };
}

function timeoutMs(environment) {
  const raw = environment.RUNTIME_MONITOR_TIMEOUT_MS?.trim();
  if (!raw) return 5_000;
  if (!/^\d+$/.test(raw)) {
    throw new Error('RUNTIME_MONITOR_TIMEOUT_MS must be an integer');
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1_000 || value > 15_000) {
    throw new Error('RUNTIME_MONITOR_TIMEOUT_MS must be between 1000 and 15000');
  }
  return value;
}

export function runtimeMonitorConfig(environment = process.env) {
  const expectedRelease = environment.RUNTIME_MONITOR_EXPECTED_RELEASE?.trim() ?? '';
  if (!SHA_PATTERN.test(expectedRelease)) {
    throw new Error(
      'RUNTIME_MONITOR_EXPECTED_RELEASE must be a full lowercase 40-character Git SHA',
    );
  }

  const endpointInputs = [
    ['cloud-api', 'RUNTIME_MONITOR_CLOUD_URL', environment.RUNTIME_MONITOR_CLOUD_URL],
    ['event-edge', 'RUNTIME_MONITOR_EDGE_URL', environment.RUNTIME_MONITOR_EDGE_URL],
    ['control-web', 'RUNTIME_MONITOR_CONTROL_URL', environment.RUNTIME_MONITOR_CONTROL_URL],
  ];

  const endpoints = {};
  for (const [service, label, rawValue] of endpointInputs) {
    const parsed = safeProbeUrl(rawValue, label);
    if (parsed.error) throw new Error(parsed.error);
    endpoints[service] = parsed.url;
  }

  return {
    expectedRelease,
    timeoutMs: timeoutMs(environment),
    endpoints,
  };
}

async function probeOne({ service, url, expectedRelease, timeout, fetchImpl, now }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const started = now();

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
    });
    const durationMs = Math.max(0, now() - started);

    if (!response.ok) {
      return {
        service,
        up: false,
        durationMs,
        releaseMatch: service === 'control-web' ? null : false,
        reason: `HTTP_${response.status}`,
      };
    }

    let body;
    try {
      body = await response.json();
    } catch {
      return {
        service,
        up: false,
        durationMs,
        releaseMatch: service === 'control-web' ? null : false,
        reason: 'INVALID_JSON',
      };
    }

    if (body?.service !== service) {
      return {
        service,
        up: false,
        durationMs,
        releaseMatch: service === 'control-web' ? null : false,
        reason: 'SERVICE_MISMATCH',
      };
    }
    if (body?.status !== 'ok') {
      return {
        service,
        up: false,
        durationMs,
        releaseMatch: service === 'control-web' ? null : false,
        reason: 'STATUS_NOT_OK',
      };
    }

    const releaseMatch = service === 'control-web' ? null : body?.releaseCommit === expectedRelease;
    if (releaseMatch === false) {
      return {
        service,
        up: false,
        durationMs,
        releaseMatch,
        reason: 'RELEASE_MISMATCH',
      };
    }

    return {
      service,
      up: true,
      durationMs,
      releaseMatch,
      reason: null,
    };
  } catch (error) {
    const durationMs = Math.max(0, now() - started);
    return {
      service,
      up: false,
      durationMs,
      releaseMatch: service === 'control-web' ? null : false,
      reason: error?.name === 'AbortError' ? 'TIMEOUT' : 'FETCH_FAILED',
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function runRuntimeMonitor({
  config,
  fetchImpl = fetch,
  now = () => performance.now(),
  generatedAt = new Date(),
}) {
  const results = [];
  for (const service of SERVICE_NAMES) {
    results.push(
      await probeOne({
        service,
        url: config.endpoints[service],
        expectedRelease: config.expectedRelease,
        timeout: config.timeoutMs,
        fetchImpl,
        now,
      }),
    );
  }

  return {
    schemaVersion: 1,
    generatedAt: generatedAt.toISOString(),
    expectedRelease: config.expectedRelease,
    status: results.every((result) => result.up) ? 'PASS' : 'BLOCKED',
    results,
  };
}

function prometheusLabelValue(value) {
  return value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('"', '\\"');
}

export function renderPrometheus(report) {
  const lines = [
    '# HELP event_commerce_runtime_probe_up Whether the external runtime probe succeeded.',
    '# TYPE event_commerce_runtime_probe_up gauge',
  ];

  for (const result of report.results) {
    const service = prometheusLabelValue(result.service);
    lines.push(`event_commerce_runtime_probe_up{service="${service}"} ${result.up ? 1 : 0}`);
  }

  lines.push(
    '# HELP event_commerce_runtime_probe_duration_seconds External runtime probe latency in seconds.',
    '# TYPE event_commerce_runtime_probe_duration_seconds gauge',
  );
  for (const result of report.results) {
    const service = prometheusLabelValue(result.service);
    lines.push(
      `event_commerce_runtime_probe_duration_seconds{service="${service}"} ${result.durationMs / 1000}`,
    );
  }

  lines.push(
    '# HELP event_commerce_runtime_release_match Whether the deployed backend reports the expected release.',
    '# TYPE event_commerce_runtime_release_match gauge',
  );
  for (const result of report.results.filter((entry) => entry.releaseMatch !== null)) {
    const service = prometheusLabelValue(result.service);
    lines.push(
      `event_commerce_runtime_release_match{service="${service}"} ${result.releaseMatch ? 1 : 0}`,
    );
  }

  return `${lines.join('\n')}\n`;
}

async function main() {
  let config;
  try {
    config = runtimeMonitorConfig();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
    return;
  }

  const report = await runRuntimeMonitor({ config });
  if (process.argv.includes('--prometheus')) {
    process.stdout.write(renderPrometheus(report));
  } else {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }

  if (report.status !== 'PASS') process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
