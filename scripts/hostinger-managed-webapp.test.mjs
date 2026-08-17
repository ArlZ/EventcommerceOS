import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const workspace = readFileSync(resolve(root, 'pnpm-workspace.yaml'), 'utf8');
const dockerfile = readFileSync(resolve(root, 'Dockerfile'), 'utf8');
const managedReadme = readFileSync(resolve(root, 'infra/hostinger/managed/README.md'), 'utf8');
const apiEnv = readFileSync(resolve(root, 'infra/hostinger/managed/cloud-api.env.example'), 'utf8');
const controlEnv = readFileSync(
  resolve(root, 'infra/hostinger/managed/control-web.env.example'),
  'utf8',
);

test('managed Hostinger path uses the observed pnpm 11 runtime contract', () => {
  assert.equal(packageJson.packageManager, 'pnpm@11.22.0');
  assert.equal(packageJson.engines?.node, '22.x');
  assert.equal(packageJson.engines?.pnpm, '11.22.0');
  assert.equal(packageJson.pnpm, undefined);
  assert.match(dockerfile, /corepack prepare pnpm@11\.22\.0 --activate/);
});

test('pnpm 11 project settings live in pnpm-workspace.yaml with reviewed build scripts only', () => {
  assert.match(workspace, /^overrides:/m);
  assert.match(workspace, /^  ajv@8\.12\.0: 8\.20\.0$/m);
  assert.match(workspace, /^  body-parser@1\.20\.4: 1\.20\.6$/m);
  assert.match(workspace, /^  multer@2\.0\.2: 2\.2\.0$/m);
  assert.match(workspace, /^  next@15\.5\.22>postcss: 8\.5\.26$/m);
  assert.match(workspace, /^  sharp@0\.34\.5: 0\.35\.0$/m);
  assert.match(workspace, /^allowBuilds:\n  esbuild: true$/m);
  assert.doesNotMatch(workspace, /^dangerouslyAllowAllBuilds:\s*true$/m);
});

test('Docker builds the workspace before pruning production deploy packages', () => {
  assert.match(dockerfile, /^ENV CI=true$/m);
  const cloudBuild = dockerfile.indexOf('pnpm --filter @event-commerce/cloud-api... build');
  const edgeBuild = dockerfile.indexOf('pnpm --filter @event-commerce/event-edge... build');
  const controlBuild = dockerfile.indexOf('pnpm --filter @event-commerce/control-web build');
  const cloudDeploy = dockerfile.indexOf(
    'pnpm --filter @event-commerce/cloud-api --prod deploy --legacy /out/cloud-api',
  );
  const edgeDeploy = dockerfile.indexOf(
    'pnpm --filter @event-commerce/event-edge --prod deploy --legacy /out/event-edge',
  );
  assert.ok(
    cloudBuild >= 0 && edgeBuild > cloudBuild && controlBuild > edgeBuild,
  );
  assert.ok(cloudDeploy > controlBuild && edgeDeploy > cloudDeploy);
});

test('managed Cloud API build and startup remain workspace-aware and migrate before serving', () => {
  assert.equal(
    packageJson.scripts?.['hostinger:cloud-api:build'],
    'pnpm --filter @event-commerce/cloud-api... build',
  );
  const start = packageJson.scripts?.['hostinger:cloud-api:start'];
  assert.equal(
    start,
    'pnpm --filter @event-commerce/cloud-api db:migrate && pnpm --filter @event-commerce/cloud-api start',
  );
  assert.ok(start.indexOf('db:migrate') < start.indexOf(' start'));
});

test('managed Event Control build and startup remain workspace-aware', () => {
  assert.equal(
    packageJson.scripts?.['hostinger:control-web:build'],
    'pnpm --filter @event-commerce/control-web... build',
  );
  assert.equal(
    packageJson.scripts?.['hostinger:control-web:start'],
    'pnpm --filter @event-commerce/control-web start',
  );
});

test('managed API example is PostgreSQL-backed, single-instance and sandbox-only', () => {
  assert.match(apiEnv, /^NODE_ENV=production$/m);
  assert.match(apiEnv, /^PORT=3000$/m);
  assert.match(apiEnv, /^DATABASE_URL=postgresql:\/\//m);
  assert.match(apiEnv, /^ABUSE_DEPLOYMENT_MODE=single_instance_pilot$/m);
  assert.match(apiEnv, /^TRUST_PROXY_HOPS=1$/m);
  assert.match(apiEnv, /^MPESA_BASE_URL=https:\/\/sandbox\.safaricom\.co\.ke$/m);
  assert.doesNotMatch(apiEnv, /^MPESA_BASE_URL=https:\/\/api\.safaricom\.co\.ke$/m);
  assert.match(apiEnv, /^MPESA_CONSUMER_KEY=$/m);
  assert.match(apiEnv, /^MPESA_CONSUMER_SECRET=$/m);
  assert.match(apiEnv, /^MPESA_PASSKEY=$/m);
});

test('managed Event Control example points only to a public HTTPS API origin', () => {
  assert.match(controlEnv, /^PORT=3000$/m);
  assert.match(
    controlEnv,
    /^NEXT_PUBLIC_CLOUD_API_URL=https:\/\/api\.pilot\.example\.com$/m,
  );
});

test('managed deployment documentation preserves the venue-local Edge boundary', () => {
  assert.match(managedReadme, /two separate Hostinger Node\.js Web Apps/);
  assert.match(managedReadme, /external PostgreSQL/);
  assert.match(managedReadme, /Event Edge remains venue-local/);
  assert.match(managedReadme, /production or 20,000-attendee capacity evidence/);
});
