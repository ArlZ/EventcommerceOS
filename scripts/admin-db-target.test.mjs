import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function run(script, args = [], environment = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'production',
      ...environment,
    },
    encoding: 'utf8',
  });
}

function assertFailedForDatabaseTarget(result, pattern) {
  assert.notEqual(result.status, 0, `command unexpectedly succeeded: ${result.stdout}`);
  assert.match(`${result.stdout}\n${result.stderr}`, pattern);
}

test('operator administration refuses production execution without DATABASE_URL', () => {
  const result = run('apps/cloud-api/scripts/manage-operator-auth.mjs', ['create-identity']);
  assertFailedForDatabaseTarget(result, /DATABASE_URL is required for production database tooling/);
});

test('Edge credential administration refuses production execution without DATABASE_URL', () => {
  const result = run('apps/cloud-api/scripts/manage-edge-credential.mjs', ['provision']);
  assertFailedForDatabaseTarget(result, /DATABASE_URL is required for production database tooling/);
});

test('POS device administration requires EDGE_DATABASE_URL and never reuses generic DATABASE_URL in production', () => {
  const result = run('apps/event-edge/scripts/manage-pos-device.mjs', ['provision'], {
    DATABASE_URL: 'postgresql://cloud.example/wrong-target',
  });
  assertFailedForDatabaseTarget(
    result,
    /EDGE_DATABASE_URL is required for production database tooling/,
  );
});
