import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateEvidenceFiles, validateManifest } from './pilot-evidence.mjs';
import { currentGitIdentity, runPreflight } from './pilot-preflight.mjs';

function check(id, passed, details) {
  return { id, status: passed ? 'PASS' : 'BLOCKED', details };
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function runPilotReleaseReview({
  manifest,
  manifestPath,
  gitIdentity,
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
}) {
  const releaseCommit =
    env.PILOT_PREFLIGHT_RELEASE_COMMIT?.trim() || gitIdentity?.releaseCommit || '';
  const structural = validateManifest(manifest, releaseCommit);
  const evidenceBlockers = validateEvidenceFiles(manifest, manifestPath);
  const preflight = await runPreflight({
    env,
    manifest,
    gitIdentity,
    fetchImpl,
    now,
  });

  const checks = [
    check(
      'manifest:all-required-gates',
      structural.ok,
      structural.ok
        ? 'all required gates are PASS with named review'
        : structural.blockers.join('; '),
    ),
    check(
      'manifest:evidence-bytes',
      evidenceBlockers.length === 0,
      evidenceBlockers.length === 0
        ? 'all retained PASS evidence files exist and match reviewed SHA-256 digests'
        : evidenceBlockers.join('; '),
    ),
    check(
      'preflight:release-and-runtime',
      preflight.status === 'PASS',
      preflight.status === 'PASS'
        ? 'exact release checkout, deployment contract and all runtime health probes passed'
        : preflight.checks
            .filter((entry) => entry.status !== 'PASS')
            .map((entry) => `${entry.id}: ${entry.details}`)
            .join('; '),
    ),
  ];

  const candidateReadyForHumanGoNoGo = checks.every((entry) => entry.status === 'PASS');
  const core = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    releaseCommit,
    status: candidateReadyForHumanGoNoGo ? 'READY_FOR_HUMAN_GO_NO_GO' : 'BLOCKED',
    candidateReadyForHumanGoNoGo,
    liveMoneyApproved: false,
    checks,
    preflight: {
      status: preflight.status,
      reportDigestSha256: preflight.reportDigestSha256,
      deployment: preflight.deployment,
      checks: preflight.checks,
    },
    scope:
      'Final controlled-pilot release review aggregation. READY means machine-verifiable prerequisites are complete and intact for named human go/no-go; it does not itself authorize live money.',
  };

  return { ...core, reportDigestSha256: digest(core) };
}

function usage() {
  console.error(
    'Usage: PILOT_EVIDENCE_MANIFEST=<manifest.json> CLOUD_HEALTH_URL=<url> EDGE_HEALTH_URL=<url> CONTROL_HEALTH_URL=<url> pnpm pilot:release:review',
  );
}

async function main() {
  const manifestInput = process.env.PILOT_EVIDENCE_MANIFEST?.trim();
  if (!manifestInput) {
    usage();
    process.exitCode = 2;
    return;
  }

  const manifestPath = resolve(manifestInput);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const gitIdentity = currentGitIdentity();
  const report = await runPilotReleaseReview({
    manifest,
    manifestPath,
    gitIdentity,
  });

  const outputPath = resolve(
    process.env.PILOT_RELEASE_REVIEW_OUTPUT?.trim() ||
      'artifacts/pilot/release-review.json',
  );
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
  });

  console.log(`Pilot release review ${report.status}: ${outputPath}`);
  console.log(`release=${report.releaseCommit} digest=${report.reportDigestSha256}`);
  for (const entry of report.checks) {
    console.log(`${entry.status} ${entry.id}: ${entry.details}`);
  }
  console.log(
    'This command never sets liveMoneyApproved=true. READY still requires the named human go/no-go decision.',
  );

  if (!report.candidateReadyForHumanGoNoGo) {
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
