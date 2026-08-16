import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const blueprint = readFileSync('infra/render/pilot/render.yaml', 'utf8');
const dockerfile = readFileSync('Dockerfile', 'utf8');

function count(needle) {
  return blueprint.split(needle).length - 1;
}

function expectBlueprint(needle) {
  assert.ok(blueprint.includes(needle), `missing Blueprint text: ${needle}`);
}

test('Render pilot stays single-instance, manual and in Frankfurt', () => {
  assert.equal(count('type: web'), 2);
  assert.equal(count('runtime: docker'), 2);
  assert.equal(count('region: frankfurt'), 3);
  assert.equal(count('autoDeployTrigger: "off"'), 2);
  assert.equal(count('numInstances: 1'), 2);
  expectBlueprint('name: eventcommerceos-arlz-pilot-api');
  expectBlueprint('name: eventcommerceos-arlz-pilot-control');
});

test('Render pilot database is private and aligned to tested PostgreSQL major', () => {
  expectBlueprint('plan: basic-1gb');
  expectBlueprint('postgresMajorVersion: "16"');
  expectBlueprint('databaseName: event_commerce_cloud');
  expectBlueprint('diskSizeGB: 15');
  expectBlueprint('connectionPool: none');
  expectBlueprint('ipAllowList: []');
  expectBlueprint('key: DATABASE_URL');
  expectBlueprint('name: eventcommerceos-arlz-pilot-db');
  expectBlueprint('property: connectionString');
});

test('Render pilot preserves bounded abuse semantics and sandbox-only M-PESA base URL', () => {
  expectBlueprint('key: ABUSE_DEPLOYMENT_MODE');
  expectBlueprint('value: single_instance_pilot');
  expectBlueprint('key: ABUSE_UPSTREAM_CONFIRMED');
  expectBlueprint('value: "false"');
  expectBlueprint('key: TRUST_PROXY_HOPS');
  expectBlueprint('value: "1"');
  expectBlueprint('value: https://sandbox.safaricom.co.ke');
  assert.doesNotMatch(blueprint, /https:\/\/api\.safaricom\.co\.ke/);
  assert.doesNotMatch(blueprint, /MPESA_CONSUMER_SECRET/);
  assert.doesNotMatch(blueprint, /MPESA_PASSKEY/);
});

test('Render pilot deploys exact releases and runs migrations before Cloud traffic', () => {
  const releaseGuard = 'test "$RELEASE_COMMIT" = "$RENDER_GIT_COMMIT"';
  assert.equal(count(releaseGuard), 3);
  expectBlueprint('preDeployCommand: >-');
  expectBlueprint('node scripts/migrate.mjs');
  assert.equal(count('key: RELEASE_COMMIT'), 2);
  assert.equal(count('key: NEXT_PUBLIC_CLOUD_API_URL'), 2);
  expectBlueprint('key: CONTROL_WEB_ORIGIN');
  assert.doesNotMatch(blueprint, /\b[0-9a-f]{40}\b/);
});

test('Render pilot health paths match the production runtime surfaces', () => {
  expectBlueprint('healthCheckPath: /health');
  expectBlueprint('healthCheckPath: /api/health');
  expectBlueprint('value: cloud-api');
  expectBlueprint('value: control-web');
});

test('Dockerfile exposes only existing hardened runtime stages to Render selection', () => {
  assert.match(dockerfile, /^ARG RUNTIME_TARGET=control-web$/m);
  assert.match(dockerfile, /^FROM runtime-base AS cloud-api$/m);
  assert.match(dockerfile, /^FROM runtime-base AS event-edge$/m);
  assert.match(dockerfile, /^FROM runtime-base AS control-web$/m);
  assert.match(dockerfile, /^FROM \$\{RUNTIME_TARGET\} AS render-runtime$/m);
});
