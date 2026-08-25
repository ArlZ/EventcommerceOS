import { spawnSync } from 'node:child_process';

const fullGitSha = /^[0-9a-f]{40}$/;

export function resolveReleaseCommit({ cwd = process.cwd(), env = process.env } = {}) {
  const git = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const gitSha = git.status === 0 ? git.stdout.trim() : '';
  if (fullGitSha.test(gitSha)) return gitSha;

  for (const name of ['RELEASE_COMMIT', 'GITHUB_SHA']) {
    const value = env[name]?.trim() ?? '';
    if (!value) continue;
    if (!fullGitSha.test(value)) {
      throw new Error(`${name} must be a lowercase 40-character Git SHA`);
    }
    return value;
  }

  throw new Error(
    'Unable to resolve release identity from the checked-out Git commit or RELEASE_COMMIT/GITHUB_SHA',
  );
}
