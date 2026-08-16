import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const compose = readFileSync('infra/hostinger/pilot/docker-compose.yml', 'utf8');
const workflow = readFileSync('.github/workflows/hostinger-pilot-deploy.yml', 'utf8');

function expectCompose(value) {
  assert.ok(compose.includes(value), `missing Compose text: ${value}`);
}

test('Hostinger pilot keeps Cloud and database boundaries explicit', () => {
  expectCompose('postgres:16.14-alpine3.22');
  expectCompose('cloud-internal:');
  expectCompose('internal: true');
  expectCompose('traefik-proxy:');
  expectCompose('external: true');
  const postgresService =
    compose.match(/  postgres:[\s\S]*?(?=\n  [a-z][\w-]*:|\nvolumes:)/)?.[0] ?? '';
  assert.doesNotMatch(postgresService, /\n\s+ports:/);
});

test('Hostinger pilot runs exact-release migrations before Cloud traffic', () => {
  expectCompose('RELEASE_COMMIT: ${RELEASE_COMMIT:?Set RELEASE_COMMIT}');
  expectCompose('command: ["node", "scripts/migrate.mjs"]');
  expectCompose('condition: service_completed_successfully');
  expectCompose('condition: service_healthy');
});

test('Hostinger pilot preserves bounded abuse semantics and sandbox M-PESA', () => {
  expectCompose('ABUSE_DEPLOYMENT_MODE: single_instance_pilot');
  expectCompose('ABUSE_UPSTREAM_CONFIRMED: "false"');
  expectCompose('TRUST_PROXY_HOPS: "1"');
  expectCompose('MPESA_BASE_URL: https://sandbox.safaricom.co.ke');
});

test('Hostinger pilot exposes only API and Control through Traefik', () => {
  expectCompose(
    'traefik.http.routers.eventcommerceos-api.rule=Host(`${CLOUD_HOST:?Set CLOUD_HOST}`)',
  );
  expectCompose(
    'traefik.http.routers.eventcommerceos-control.rule=Host(`${CONTROL_HOST:?Set CONTROL_HOST}`)',
  );
  expectCompose('traefik.http.services.eventcommerceos-api.loadbalancer.server.port=3001');
  expectCompose('traefik.http.services.eventcommerceos-control.loadbalancer.server.port=3000');
});

test('Hostinger deployment workflow is manual, immutable and verifies the exact checkout', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s*push:/m);
  assert.match(
    workflow,
    /uses: actions\/checkout@d23441a48e516b6c34aea4fa41551a30e30af803/,
  );
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /ref: \$\{\{ inputs\.release_commit \}\}/);
  assert.match(workflow, /test "\$\(git rev-parse HEAD\)" = "\$RELEASE_COMMIT"/);
  assert.match(
    workflow,
    /uses: hostinger\/deploy-on-vps@b0868cec74bfa63af6bfa7bdb0dfee2f9bef13ea/,
  );
  assert.match(workflow, /docker-compose-path: infra\/hostinger\/pilot\/docker-compose\.yml/);
});
