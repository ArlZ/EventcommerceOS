import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const blueprint = readFileSync('infra/render/pilot/render.yaml', 'utf8');
const dockerfile = readFileSync('Dockerfile', 'utf8');

function occurrences(value, needle) {
  return value.split(needle).length - 1;
}

test('Render pilot stays single-instance, manual and in Frankfurt', () => {
  assert.equal(occurrences(blueprint, 'type: web'), 2);
  assert.equal(occurrences(blueprint, 'runtime: docker'), 2);
  assert.equal(occurrences(blueprint, 'region: frankfurt'), 3);
  assert.equal(occurrences(blueprint, 'autoDeployTrigger: "off"'), 2);
  assert.equal(occurrences(blueprint, 'numInstances: 1'), 2);
  assert.match(blueprint, /name: eventcommerceos-arlz-pilot-api/);
  assert.match(blueprint, /name: eventcommerceos-arlz-pilot-control/);
});

test('Render pilot database is private and aligned to tested PostgreSQL major', () => {
  assert.match(blueprint, /plan: basic-1gb/);
  assert.match(blueprint, /postgresMajorVersion: "16"/);
  assert.match(blueprint, /databaseName: event_commerce_cloud/);
  assert.match(blueprint, /diskSizeGB: 15/);
  assert.match(blueprint, /connectionPool: none/);
  assert.match(blueprint, /ipAllowList: \[\]/);
  assert.match(
    blueprint,
    /key: DATABASE_URL\s+fromDatabase:\s+name: eventcommerceos-arlz-pilot-db\s+property: connectionString/s,
  );
});

test('Render pilot preserves bounded abuse semantics and sandbox-only M-PESA base URL', () => {
  assert.match(
    blueprint,
    /key: ABUSE_DEPLOYMENT_MODE\s+value: single_instance_pilot/s,
  );
  assert.match(blueprint, /key: ABUSE_UPSTREAM_CONFIRMED\s+value: "false"/s);
  assert.match(blueprint, /key: TRUST_PROXY_HOPS\s+value: "1"/s);
  assert.match(blueprint, /value: https:\/\/sandbox\.safaricom\.co\.ke/);
  assert.doesNotMatch(blueprint, /https:\/\/api\.safaricom\.co\.ke/);
  assert.doesNotMatch(blueprint, /MPESA_CONSUMER_SECRET/);
  assert.doesNotMatch(blueprint, /MPESA_PASSKEY/);
});

test('Render pilot deploys exact releases and runs migrations before Cloud traffic', () => {
  assert.equal(
    occurrences(blueprint, 'test "$RELEASE_COMMIT" = "$RENDER_GIT_COMMIT"'),
    3,
  );
  assert.match(blueprint, /preDeployCommand:[\s\S]*node scripts\/migrate\.mjs/);
  assert.equal(occurrences(blueprint, 'key: RELEASE_COMMIT\n        sync: false'), 2);
  assert.equal(occurrences(blueprint, 'key: NEXT_PUBLIC_CLOUD_API_URL\n        sync: false'), 2);
  assert.match(blueprint, /key: CONTROL_WEB_ORIGIN\s+sync: false/s);
  assert.doesNotMatch(blueprint, /\b[0-9a-f]{40}\b/);
});

test('Render pilot health paths match the production runtime surfaces', () => {
  assert.match(blueprint, /healthCheckPath: \/health/);
  assert.match(blueprint, /healthCheckPath: \/api\/health/);
  assert.match(blueprint, /value: cloud-api/);
  assert.match(blueprint, /value: control-web/);
});

test('Dockerfile exposes only existing hardened runtime stages to Render selection', () => {
  assert.match(dockerfile, /^ARG RUNTIME_TARGET=control-web$/m);
  assert.match(dockerfile, /^FROM runtime-base AS cloud-api$/m);
  assert.match(dockerfile, /^FROM runtime-base AS event-edge$/m);
  assert.match(dockerfile, /^FROM runtime-base AS control-web$/m);
  assert.match(dockerfile, /^FROM \$\{RUNTIME_TARGET\} AS render-runtime$/m);
});
