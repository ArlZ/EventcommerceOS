import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { resolveReleaseCommit } from './release-identity.mjs';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(scriptDir, '..');

test('release identity prefers the exact checked-out Git commit', () => {
  const expected = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();

  assert.equal(
    resolveReleaseCommit({
      cwd: repoRoot,
      env: { RELEASE_COMMIT: 'b'.repeat(40) },
    }),
    expected,
  );
});

test('release identity falls back to explicit exact SHA without Git metadata', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'event-commerce-release-'));
  try {
    assert.equal(
      resolveReleaseCommit({
        cwd: directory,
        env: { RELEASE_COMMIT: 'a'.repeat(40) },
      }),
      'a'.repeat(40),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('release identity rejects malformed explicit fallback', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'event-commerce-release-'));
  try {
    assert.throws(
      () =>
        resolveReleaseCommit({
          cwd: directory,
          env: { RELEASE_COMMIT: 'not-a-sha' },
        }),
      /lowercase 40-character Git SHA/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('SEC-009 intentional failing branch protection proof', () => {
  assert.fail('intentional SEC-009 branch protection proof failure');
});
