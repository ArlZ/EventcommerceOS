import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const fullGitSha = /^[0-9a-f]{40}$/;

export function runtimeReleaseCommit(): string | null {
  const bakedPath = resolve(__dirname, '..', 'release-commit.txt');
  if (existsSync(bakedPath)) {
    const baked = readFileSync(bakedPath, 'utf8').trim();
    if (fullGitSha.test(baked)) return baked;
  }

  const configured = process.env.RELEASE_COMMIT?.trim() ?? '';
  return fullGitSha.test(configured) ? configured : null;
}
