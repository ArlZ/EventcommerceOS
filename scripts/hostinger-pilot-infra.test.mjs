import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const compose = readFileSync(resolve(root, 'infra/hostinger/pilot/docker-compose.yml'), 'utf8');
const deploy = readFileSync(resolve(root, 'infra/hostinger/pilot/deploy.sh'), 'utf8');
const backup = readFileSync(resolve(root, 'infra/hostinger/pilot/backup.sh'), 'utf8');
const restore = readFileSync(resolve(root, 'infra/hostinger/pilot/restore-check.sh'), 'utf8');
const envExample = readFileSync(resolve(root, 'infra/hostinger/pilot/.env.example'), 'utf8');

function serviceBlock(name, nextName) {
  const start = compose.indexOf(`  ${name}:\n`);
  assert.notEqual(start, -1, `missing ${name} service`);
  const end = nextName
    ? compose.indexOf(`  ${nextName}:\n`, start + 1)
    : compose.indexOf('\nvolumes:\n', start + 1);
  assert.notEqual(end, -1, `unable to bound ${name} service`);
  return compose.slice(start, end);
}

test('Hostinger pilot keeps PostgreSQL private and pins its image digest', () => {
  const postgres = serviceBlock('postgres', 'cloud-api');
  assert.match(postgres, /postgres:16\.14-alpine3\.24@sha256:[0-9a-f]{64}/);
  assert.doesNotMatch(postgres, /^\s+ports:/m);
  assert.match(postgres, /app-internal/);
  assert.match(compose, /app-internal:\n\s+internal: true/);
});

test('Hostinger pilot exposes applications only through external Traefik HTTPS routing', () => {
  const api = serviceBlock('cloud-api', 'control-web');
  const control = serviceBlock('control-web', null);
  for (const block of [api, control]) {
    assert.doesNotMatch(block, /^\s+ports:/m);
    assert.match(block, /read_only: true/);
    assert.match(block, /cap_drop:\n\s+- ALL/);
    assert.match(block, /no-new-privileges:true/);
    assert.match(block, /traefik-proxy/);
    assert.match(block, /entrypoints=websecure/);
    assert.match(block, /tls\.certresolver=letsencrypt/);
  }
  assert.match(compose, /external: true/);
});

test('Hostinger pilot remains single-instance and M-PESA sandbox-only', () => {
  const api = serviceBlock('cloud-api', 'control-web');
  assert.match(api, /ABUSE_DEPLOYMENT_MODE: single_instance_pilot/);
  assert.match(api, /ABUSE_UPSTREAM_CONFIRMED: 'false'/);
  assert.match(api, /TRUST_PROXY_HOPS: '1'/);
  assert.match(api, /MPESA_BASE_URL: https:\/\/sandbox\.safaricom\.co\.ke/);
  assert.doesNotMatch(api, /api\.safaricom\.co\.ke/);
  assert.doesNotMatch(compose, /^\s+event-edge:/m);
});

test('Hostinger deployment binds build, runtime, migration and smoke to exact release identity', () => {
  assert.match(compose, /image: event-commerce\/cloud-api:\$\{RELEASE_COMMIT/);
  assert.match(compose, /image: event-commerce\/control-web:\$\{RELEASE_COMMIT/);
  assert.match(compose, /RELEASE_COMMIT: \$\{RELEASE_COMMIT/);
  assert.match(deploy, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(deploy, /rev-parse HEAD/);
  assert.match(deploy, /status --porcelain --untracked-files=no/);
  assert.match(deploy, /org\.opencontainers\.image\.revision/);
  const migrationPosition = deploy.indexOf('node scripts/migrate.mjs');
  const appStartPosition = deploy.indexOf('up -d cloud-api control-web');
  assert.ok(
    migrationPosition > 0 && appStartPosition > migrationPosition,
    'migration must run before app startup',
  );
  assert.match(deploy, /smoke\.sh/);
});

test('Hostinger backup tooling hashes dumps, retains locally, and supports isolated restore checking', () => {
  assert.match(backup, /pg_dump/);
  assert.match(backup, /sha256sum/);
  assert.match(backup, /-mtime \+7 -delete/);
  assert.match(restore, /sha256sum -c/);
  assert.match(restore, /pg_restore/);
  assert.match(restore, /event_commerce_restore/);
  assert.match(restore, /public_tables/);
});

test('Hostinger example environment contains placeholders rather than committed credentials', () => {
  assert.match(envExample, /POSTGRES_PASSWORD=replace-with-64-lowercase-hex-characters/);
  assert.match(envExample, /MPESA_CONSUMER_KEY=\n/);
  assert.match(envExample, /MPESA_CONSUMER_SECRET=\n/);
  assert.match(envExample, /MPESA_PASSKEY=\n/);
  assert.doesNotMatch(envExample, /sandbox\.safaricom\.co\.ke/);
});
