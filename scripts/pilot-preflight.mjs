import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REQUIRED_GATES, REQUIRED_OWNERS, validateEvidenceRef } from './pilot-evidence.mjs';

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const GATE_STATUSES = new Set(['NOT_RUN', 'PASS', 'FAIL']);
const DEPLOYMENT_MODES = new Set(['single_instance_pilot', 'upstream_distributed']);
const LOCAL_HEALTH_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function gitText(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

export function currentGitIdentity() {
  return {
    releaseCommit: gitText(['rev-parse', 'HEAD']),
    releaseTree: gitText(['rev-parse', 'HEAD^{tree}']),
    trackedWorktreeClean: gitText(['status', '--porcelain', '--untracked-files=no']) === '',
  };
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function check(id, passed, details) {
  return {
    id,
    status: passed ? 'PASS' : 'BLOCKED',
    details,
  };
}

function safeHealthUrl(rawValue, label) {
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
    return {
      error: `${label} must not contain credentials, query parameters, or fragments`,
    };
  }

  const isLocal = LOCAL_HEALTH_HOSTS.has(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(isLocal && parsed.protocol === 'http:')) {
    return {
      error: `${label} must use HTTPS unless it targets localhost`,
    };
  }

  return { url: parsed.toString() };
}

function parseTrustProxyHops(rawValue) {
  if (!nonEmptyString(rawValue)) {
    return null;
  }
  if (!/^\d+$/.test(rawValue.trim())) {
    return null;
  }
  const value = Number(rawValue);
  return Number.isSafeInteger(value) ? value : null;
}

export function validateDeploymentConfig(env) {
  const mode = env.ABUSE_DEPLOYMENT_MODE?.trim() ?? '';
  const upstreamConfirmed = env.ABUSE_UPSTREAM_CONFIRMED?.trim().toLowerCase() === 'true';
  const trustProxyHops = parseTrustProxyHops(env.TRUST_PROXY_HOPS);
  const errors = [];

  if (!DEPLOYMENT_MODES.has(mode)) {
    errors.push('ABUSE_DEPLOYMENT_MODE must be single_instance_pilot or upstream_distributed');
  }

  if (trustProxyHops === null) {
    errors.push('TRUST_PROXY_HOPS must be a non-negative integer');
  }

  if (mode === 'upstream_distributed') {
    if (!upstreamConfirmed) {
      errors.push('upstream_distributed requires ABUSE_UPSTREAM_CONFIRMED=true');
    }
    if (trustProxyHops === null || trustProxyHops < 1) {
      errors.push('upstream_distributed requires TRUST_PROXY_HOPS>=1');
    }
  }

  return {
    mode,
    upstreamConfirmed,
    trustProxyHops,
    errors,
  };
}

function validateClaimedPass(gateName, gate, errors) {
  if (gate.status !== 'PASS') {
    return;
  }

  if (!Array.isArray(gate.evidenceRefs) || gate.evidenceRefs.length === 0) {
    errors.push(`${gateName} is PASS without evidenceRefs`);
  } else {
    gate.evidenceRefs.forEach((reference, index) => {
      for (const error of validateEvidenceRef(reference)) {
        errors.push(`${gateName} evidenceRefs[${index}] ${error}`);
      }
    });
  }

  if (!nonEmptyString(gate.reviewer)) {
    errors.push(`${gateName} is PASS without a named reviewer`);
  }

  if (!nonEmptyString(gate.reviewedAt) || !RFC3339_PATTERN.test(gate.reviewedAt)) {
    errors.push(`${gateName} is PASS without a valid RFC3339 reviewedAt`);
  }

  if (gateName === 'representativeRecovery' && gate.representativeData !== true) {
    errors.push('representativeRecovery PASS requires representativeData=true');
  }

  if (
    gateName === 'dependencySecurity' &&
    (!Number.isInteger(gate.blockingFindings) || gate.blockingFindings !== 0)
  ) {
    errors.push('dependencySecurity PASS requires blockingFindings=0');
  }
}

export function validatePilotManifestReadiness(manifest, releaseCommit, deploymentMode) {
  const errors = [];

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['pilot evidence manifest must be a JSON object'];
  }

  if (manifest.schemaVersion !== 2) {
    errors.push('pilot evidence manifest schemaVersion must equal 2');
  }

  if (manifest.releaseCommit !== releaseCommit) {
    errors.push('pilot evidence manifest releaseCommit does not match the preflight release');
  }

  if (!manifest.pilot || typeof manifest.pilot !== 'object' || Array.isArray(manifest.pilot)) {
    errors.push('pilot evidence manifest is missing pilot metadata');
  } else {
    for (const field of ['eventName', 'venue']) {
      if (!nonEmptyString(manifest.pilot[field])) {
        errors.push(`pilot.${field} is required before field validation`);
      }
    }
    if (!nonEmptyString(manifest.pilot.eventDate) || !DATE_PATTERN.test(manifest.pilot.eventDate)) {
      errors.push('pilot.eventDate must use YYYY-MM-DD');
    }
    if (manifest.pilot.deploymentMode !== deploymentMode) {
      errors.push('pilot.deploymentMode does not match ABUSE_DEPLOYMENT_MODE');
    }
  }

  if (!manifest.owners || typeof manifest.owners !== 'object' || Array.isArray(manifest.owners)) {
    errors.push('pilot evidence manifest is missing owners');
  } else {
    for (const owner of REQUIRED_OWNERS) {
      if (!nonEmptyString(manifest.owners[owner])) {
        errors.push(`owners.${owner} must name the accountable person`);
      }
    }
  }

  if (!manifest.gates || typeof manifest.gates !== 'object' || Array.isArray(manifest.gates)) {
    errors.push('pilot evidence manifest is missing gates');
  } else {
    for (const gateName of REQUIRED_GATES) {
      const gate = manifest.gates[gateName];
      if (!gate || typeof gate !== 'object' || Array.isArray(gate)) {
        errors.push(`gates.${gateName} is required`);
        continue;
      }
      if (!GATE_STATUSES.has(gate.status)) {
        errors.push(`gates.${gateName}.status must be NOT_RUN, PASS, or FAIL`);
        continue;
      }
      validateClaimedPass(gateName, gate, errors);
    }
  }

  return errors;
}

async function probeHealth({ label, url, expectedService, releaseCommit, fetchImpl }) {
  const parsed = safeHealthUrl(url, label);
  if (parsed.error) {
    return check(`health:${expectedService}`, false, parsed.error);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);

  try {
    const response = await fetchImpl(parsed.url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
    });

    if (!response.ok) {
      return check(`health:${expectedService}`, false, `${label} returned HTTP ${response.status}`);
    }

    let body;
    try {
      body = await response.json();
    } catch {
      return check(`health:${expectedService}`, false, `${label} did not return valid JSON`);
    }

    if (body?.service !== expectedService) {
      return check(
        `health:${expectedService}`,
        false,
        `${label} reported service ${JSON.stringify(body?.service)} instead of ${expectedService}`,
      );
    }
    if (body?.status !== 'ok') {
      return check(`health:${expectedService}`, false, `${label} reported non-ok health status`);
    }
    if (body?.releaseCommit !== releaseCommit) {
      return check(
        `health:${expectedService}`,
        false,
        `${label} releaseCommit does not match the preflight release`,
      );
    }

    return check(
      `health:${expectedService}`,
      true,
      `${expectedService} is reachable and reports release ${releaseCommit}`,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return check(`health:${expectedService}`, false, `${label} probe failed: ${reason}`);
  } finally {
    clearTimeout(timeout);
  }
}

export async function runPreflight({
  env = process.env,
  manifest,
  gitIdentity,
  fetchImpl = fetch,
  now = new Date(),
}) {
  const checks = [];
  const configuredRelease = env.PILOT_PREFLIGHT_RELEASE_COMMIT?.trim() ?? '';
  const releaseCommit = configuredRelease || gitIdentity?.releaseCommit || '';

  checks.push(
    check(
      'release:sha',
      SHA_PATTERN.test(releaseCommit),
      SHA_PATTERN.test(releaseCommit)
        ? `release commit is ${releaseCommit}`
        : 'release commit must be a full lowercase 40-character Git SHA',
    ),
  );

  if (gitIdentity) {
    checks.push(
      check(
        'release:checkout',
        gitIdentity.releaseCommit === releaseCommit,
        gitIdentity.releaseCommit === releaseCommit
          ? 'Git checkout matches the configured preflight release'
          : 'Git checkout does not match the configured preflight release',
      ),
    );
    checks.push(
      check(
        'release:tracked-worktree',
        gitIdentity.trackedWorktreeClean === true,
        gitIdentity.trackedWorktreeClean === true
          ? 'tracked release checkout is clean'
          : 'tracked release checkout has uncommitted changes',
      ),
    );
  }

  const deployment = validateDeploymentConfig(env);
  checks.push(
    check(
      'deployment:abuse-contract',
      deployment.errors.length === 0,
      deployment.errors.length === 0
        ? `${deployment.mode}; trust proxy hops=${deployment.trustProxyHops}; upstream confirmed=${deployment.upstreamConfirmed}`
        : deployment.errors.join('; '),
    ),
  );

  const manifestErrors = validatePilotManifestReadiness(manifest, releaseCommit, deployment.mode);
  checks.push(
    check(
      'pilot:evidence-manifest',
      manifestErrors.length === 0,
      manifestErrors.length === 0
        ? 'manifest is bound to this release and has named pilot ownership'
        : manifestErrors.join('; '),
    ),
  );

  checks.push(
    await probeHealth({
      label: 'CLOUD_HEALTH_URL',
      url: env.CLOUD_HEALTH_URL,
      expectedService: 'cloud-api',
      releaseCommit,
      fetchImpl,
    }),
  );
  checks.push(
    await probeHealth({
      label: 'EDGE_HEALTH_URL',
      url: env.EDGE_HEALTH_URL,
      expectedService: 'event-edge',
      releaseCommit,
      fetchImpl,
    }),
  );

  const reportCore = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    releaseCommit,
    releaseTree: gitIdentity?.releaseTree ?? null,
    deployment: {
      mode: deployment.mode || null,
      trustProxyHops: deployment.trustProxyHops,
      upstreamConfirmed: deployment.upstreamConfirmed,
    },
    status: checks.every((entry) => entry.status === 'PASS') ? 'PASS' : 'BLOCKED',
    checks,
    fieldEvidenceSatisfied: false,
    fieldEvidenceNotice:
      'Preflight does not satisfy or mutate hardware, network, payment, abuse, recovery, inventory-close, branch-protection, or controlled-pilot evidence gates.',
  };

  const reportDigestSha256 = createHash('sha256').update(JSON.stringify(reportCore)).digest('hex');

  return { ...reportCore, reportDigestSha256 };
}

function printUsage() {
  console.error(
    'Usage: PILOT_EVIDENCE_MANIFEST=<manifest.json> CLOUD_HEALTH_URL=<url> EDGE_HEALTH_URL=<url> pnpm pilot:preflight',
  );
}

async function main() {
  const manifestPath = process.env.PILOT_EVIDENCE_MANIFEST?.trim();
  if (!manifestPath) {
    printUsage();
    process.exitCode = 2;
    return;
  }

  let gitIdentity;
  try {
    gitIdentity = currentGitIdentity();
  } catch (error) {
    console.error(`Unable to determine Git release identity: ${error.message}`);
    process.exitCode = 2;
    return;
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(resolve(manifestPath), 'utf8'));
  } catch (error) {
    console.error(`Unable to read pilot evidence manifest: ${error.message}`);
    process.exitCode = 2;
    return;
  }

  const report = await runPreflight({ manifest, gitIdentity });
  const outputPath = resolve(
    process.env.PILOT_PREFLIGHT_OUTPUT?.trim() || 'artifacts/pilot/preflight.json',
  );
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`Pilot preflight ${report.status}: ${outputPath}`);
  console.log(`release=${report.releaseCommit} digest=${report.reportDigestSha256}`);
  for (const entry of report.checks) {
    console.log(`${entry.status} ${entry.id}: ${entry.details}`);
  }
  if (report.fieldEvidenceSatisfied === false) {
    console.log(report.fieldEvidenceNotice);
  }

  if (report.status !== 'PASS') {
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
