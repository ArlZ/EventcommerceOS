import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { resolveReleaseCommit } from './release-identity.mjs';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const target = process.env.HOSTINGER_APP_TARGET ?? 'all';
const releaseCommit = resolveReleaseCommit({ cwd: repoRoot });

const argsByTarget = {
  'control-web': ['pnpm', '--filter', '@event-commerce/control-web...', 'build'],
  'cloud-api': ['pnpm', '--filter', '@event-commerce/cloud-api...', 'build'],
  all: ['pnpm', '-r', '--if-present', 'build'],
};

const args = argsByTarget[target];

if (!args) {
  console.error(`Unsupported HOSTINGER_APP_TARGET: ${target}`);
  process.exit(1);
}

console.log(`Building Event Commerce OS target: ${target} (${releaseCommit})`);
const result = spawnSync('corepack', args, {
  cwd: repoRoot,
  env: { ...process.env, HOSTINGER_APP_TARGET: target, RELEASE_COMMIT: releaseCommit },
  stdio: 'inherit',
});

if (result.error) {
  console.error('Failed to invoke Corepack for the build', result.error);
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

if (target === 'control-web') {
  verifyControlWebStaticExport();
}
if (target === 'cloud-api' || target === 'all') {
  writeCloudReleaseIdentity();
}

process.exit(0);

function verifyControlWebStaticExport() {
  const outputRoot = resolve(repoRoot, 'apps/control-web/out');
  const index = resolve(outputRoot, 'index.html');
  const htaccess = resolve(outputRoot, '.htaccess');

  if (!existsSync(index)) {
    console.error(`Managed Control Web static export was not generated at ${index}`);
    process.exit(1);
  }
  if (!existsSync(htaccess)) {
    console.error(`Managed Control Web security rules were not exported at ${htaccess}`);
    process.exit(1);
  }

  console.log(`Verified managed Event Control static export at ${outputRoot}`);
}

function writeCloudReleaseIdentity() {
  const distRoot = resolve(repoRoot, 'apps/cloud-api/dist');
  const output = resolve(distRoot, 'release-commit.txt');
  if (!existsSync(distRoot)) {
    console.error(`Cloud API build output was not generated at ${distRoot}`);
    process.exit(1);
  }
  writeFileSync(output, `${releaseCommit}\n`, { mode: 0o444 });
  console.log(`Baked Cloud API release identity at ${output}`);
}
