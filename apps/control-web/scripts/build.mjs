import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveReleaseCommit } from '../../../scripts/release-identity.mjs';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const appRoot = resolve(scriptDir, '..');
const repoRoot = resolve(appRoot, '../..');
const releaseCommit = resolveReleaseCommit({ cwd: repoRoot });

console.log(`Building Event Control release ${releaseCommit}`);
const result = spawnSync('corepack', ['pnpm', 'exec', 'next', 'build'], {
  cwd: appRoot,
  env: { ...process.env, RELEASE_COMMIT: releaseCommit },
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
