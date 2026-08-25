import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const TARGET_ROLES = new Set([
  'CLOUD_PUBLIC',
  'CLOUD_CONCURRENCY',
  'CLOUD_OPERATOR_READ',
  'EDGE_DEVICE_SYNC',
  'EDGE_OTHER',
  'PROVIDER_CALLBACK',
]);
const TEST_ENVIRONMENTS = new Set(['local', 'sandbox', 'controlled-pilot']);

function integer(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function nonEmpty(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function safeTarget(url) {
  return `${url.origin}${url.pathname}`;
}

function validateUrl(value) {
  const url = new URL(nonEmpty(value, 'config.url'));
  const localhost = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(localhost && url.protocol === 'http:')) {
    throw new Error('config.url must use HTTPS unless the target is localhost');
  }
  if (url.username || url.password) throw new Error('config.url must not contain credentials');
  return url;
}

function readBody(config, configPath) {
  if (config.bodyFile === undefined) return undefined;
  const relative = nonEmpty(config.bodyFile, 'config.bodyFile');
  const path = resolve(dirname(configPath), relative);
  return readFileSync(path, 'utf8');
}

function buildHeaders(config) {
  if (config.headers !== undefined) {
    throw new Error('Literal config.headers are prohibited; use headersFromEnv so secrets are not stored');
  }
  const headers = {};
  const mapping = config.headersFromEnv ?? {};
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
    throw new Error('config.headersFromEnv must be an object');
  }
  for (const [header, envName] of Object.entries(mapping)) {
    const name = nonEmpty(header, 'header name');
    const variable = nonEmpty(envName, `environment variable for ${name}`);
    const value = process.env[variable];
    if (!value) throw new Error(`Required probe header environment variable is missing: ${variable}`);
    headers[name] = value;
  }
  if (config.contentType) headers['Content-Type'] = nonEmpty(config.contentType, 'config.contentType');
  return headers;
}

export function normalizeProbeConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('probe config must be a JSON object');
  }
  if (config.schemaVersion !== 1) throw new Error('config.schemaVersion must equal 1');
  const releaseCommit = nonEmpty(config.releaseCommit, 'config.releaseCommit');
  if (!SHA_PATTERN.test(releaseCommit)) {
    throw new Error('config.releaseCommit must be a lowercase 40-character Git SHA');
  }
  const scenarioId = nonEmpty(config.scenarioId, 'config.scenarioId');
  const targetRole = nonEmpty(config.targetRole, 'config.targetRole');
  if (!TARGET_ROLES.has(targetRole)) throw new Error(`Unsupported config.targetRole: ${targetRole}`);
  const environment = nonEmpty(config.environment, 'config.environment');
  if (!TEST_ENVIRONMENTS.has(environment)) {
    throw new Error('config.environment must be local, sandbox or controlled-pilot');
  }
  if (config.targetOwnershipAcknowledged !== true) {
    throw new Error('config.targetOwnershipAcknowledged must be true for a controlled test target');
  }
  const url = validateUrl(config.url);
  const method = String(config.method ?? 'GET').trim().toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    throw new Error(`Unsupported config.method: ${method}`);
  }
  return {
    schemaVersion: 1,
    releaseCommit,
    scenarioId,
    targetRole,
    environment,
    targetOwnershipAcknowledged: true,
    url,
    method,
    totalRequests: integer(config.totalRequests ?? 60, 'config.totalRequests', 1, 2000),
    concurrency: integer(config.concurrency ?? 10, 'config.concurrency', 1, 128),
    requestTimeoutMs: integer(config.requestTimeoutMs ?? 5000, 'config.requestTimeoutMs', 250, 30000),
    recovery: config.recovery !== false,
  };
}

function responseMetadata(response, durationMs) {
  return {
    status: response.status,
    durationMs,
    retryAfter: response.headers.get('retry-after'),
    rateLimitPolicy: response.headers.get('x-ratelimit-policy'),
    concurrencyLimit: response.headers.get('x-concurrency-limit'),
    authConcurrencyLimit: response.headers.get('x-auth-concurrency-limit'),
  };
}

async function oneRequest({ fetchImpl, url, method, headers, body, timeoutMs }) {
  const started = Date.now();
  try {
    const response = await fetchImpl(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const result = responseMetadata(response, Date.now() - started);
    try {
      await response.body?.cancel();
    } catch {
      // Response metadata is sufficient for this field probe.
    }
    return result;
  } catch (error) {
    const timeout = error instanceof DOMException && error.name === 'TimeoutError';
    return {
      status: null,
      durationMs: Date.now() - started,
      errorCode: timeout ? 'TIMEOUT' : 'TRANSPORT_ERROR',
    };
  }
}

function numericHeader(values, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  return [...new Set(values)]
    .map((value) => Number(value))
    .filter((value) => Number.isSafeInteger(value) && value >= minimum && value <= maximum)
    .sort((a, b) => a - b);
}

export function summarizeProbe({ normalized, results, recovery, startedAt, completedAt }) {
  const statusCounts = {};
  for (const result of results) {
    if (result.status !== null) {
      const key = String(result.status);
      statusCounts[key] = (statusCounts[key] ?? 0) + 1;
    }
  }
  const observedRateLimitPolicies = [
    ...new Set(results.map((entry) => entry.rateLimitPolicy).filter(Boolean)),
  ].sort();
  const retryAfterSeconds = numericHeader(
    results.map((entry) => entry.retryAfter).filter(Boolean),
    0,
    300,
  );
  const observedConcurrencyLimits = numericHeader(
    results.map((entry) => entry.concurrencyLimit).filter(Boolean),
    1,
  );
  const observedAuthConcurrencyLimits = numericHeader(
    results.map((entry) => entry.authConcurrencyLimit).filter(Boolean),
    1,
  );

  return {
    schemaVersion: 1,
    releaseCommit: normalized.releaseCommit,
    scenarioId: normalized.scenarioId,
    targetRole: normalized.targetRole,
    environment: normalized.environment,
    target: safeTarget(normalized.url),
    startedAt,
    completedAt,
    durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
    requestCount: results.length,
    concurrency: normalized.concurrency,
    statusCounts,
    successCount: results.filter((entry) => entry.status >= 200 && entry.status < 300).length,
    rateLimitedCount: results.filter((entry) => entry.status === 429).length,
    transportErrorCount: results.filter((entry) => entry.status === null).length,
    observedRateLimitPolicies,
    observedConcurrencyLimits,
    observedAuthConcurrencyLimits,
    retryAfterSeconds,
    recovery,
    liveMoneyApproved: false,
  };
}

export async function runAbuseProbe(config, options = {}) {
  const normalized = normalizeProbeConfig(config);
  const configPath = resolve(options.configPath ?? process.cwd(), options.configPath ? '..' : '.');
  const body = options.body ?? readBody(config, options.configFilePath ?? configPath);
  const headers = options.headers ?? buildHeaders(config);
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)));
  const requestOptions = {
    fetchImpl,
    url: normalized.url,
    method: normalized.method,
    headers,
    body,
    timeoutMs: normalized.requestTimeoutMs,
  };

  const startedAt = new Date().toISOString();
  const results = new Array(normalized.totalRequests);
  let next = 0;
  async function worker() {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= results.length) return;
      results[index] = await oneRequest(requestOptions);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(normalized.concurrency, normalized.totalRequests) }, () => worker()),
  );

  let recovery = { attempted: false, delayMs: 0, status: null, errorCode: null };
  if (normalized.recovery) {
    const retryValues = numericHeader(
      results.map((entry) => entry.retryAfter).filter(Boolean),
      0,
      300,
    );
    const delayMs = Math.min((retryValues.at(-1) ?? (results.some((entry) => entry.status === 429) ? 1 : 0)) * 1000 + 250, 30000);
    if (delayMs > 0) await sleep(delayMs);
    const recoveryResult = await oneRequest(requestOptions);
    recovery = {
      attempted: true,
      delayMs,
      status: recoveryResult.status,
      errorCode: recoveryResult.errorCode ?? null,
    };
  }

  const completedAt = new Date().toISOString();
  return summarizeProbe({ normalized, results, recovery, startedAt, completedAt });
}

function usage() {
  console.error('Usage: node scripts/http-abuse-probe.mjs <config.json> [output.json]');
}

async function main() {
  const configFilePath = process.argv[2];
  if (!configFilePath) {
    usage();
    process.exitCode = 2;
    return;
  }
  const absoluteConfig = resolve(configFilePath);
  const config = JSON.parse(readFileSync(absoluteConfig, 'utf8'));
  const report = await runAbuseProbe(config, { configFilePath: absoluteConfig });
  const outputPath = resolve(process.argv[3] ?? `artifacts/pilot/abuse-${config.scenarioId ?? Date.now()}.json`);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(
    `Abuse probe complete: ${outputPath} requests=${report.requestCount} 429=${report.rateLimitedCount} recovery=${report.recovery.status ?? report.recovery.errorCode ?? 'not-run'}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
