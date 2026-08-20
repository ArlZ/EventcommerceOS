import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const cloudApiPackageJson = JSON.parse(
  readFileSync(resolve(root, 'apps/cloud-api/package.json'), 'utf8'),
);
const controlWebPackageJson = JSON.parse(
  readFileSync(resolve(root, 'apps/control-web/package.json'), 'utf8'),
);
const controlWebConfig = readFileSync(resolve(root, 'apps/control-web/next.config.ts'), 'utf8');
const controlWebHtaccess = readFileSync(
  resolve(root, 'apps/control-web/public/.htaccess'),
  'utf8',
);
const supabaseHelper = readFileSync(resolve(root, 'apps/cloud-api/db.js'), 'utf8');
const workspace = readFileSync(resolve(root, 'pnpm-workspace.yaml'), 'utf8');
const dockerfile = readFileSync(resolve(root, 'Dockerfile'), 'utf8');
const hostingerEntry = readFileSync(resolve(root, 'server.js'), 'utf8');
const managedReadme = readFileSync(resolve(root, 'infra/hostinger/managed/README.md'), 'utf8');
const apiEnv = readFileSync(resolve(root, 'infra/hostinger/managed/cloud-api.env.example'), 'utf8');
const controlEnv = readFileSync(
  resolve(root, 'infra/hostinger/managed/control-web.env.example'),
  'utf8',
);

test('managed Hostinger uses pnpm 11', () => {
  assert.equal(packageJson.packageManager, 'pnpm@11.22.0');
  assert.equal(packageJson.engines?.node, '22.x');
  assert.equal(packageJson.engines?.pnpm, '11.22.0');
  assert.equal(packageJson.pnpm, undefined);
  assert.match(dockerfile, /corepack prepare pnpm@11\.22\.0 --activate/);
});

test('pnpm 11 settings live in the workspace file', () => {
  assert.match(workspace, /^overrides:/m);
  assert.match(workspace, /^  ajv@8\.12\.0: 8\.20\.0$/m);
  assert.match(workspace, /^  body-parser@1\.20\.4: 1\.20\.6$/m);
  assert.match(workspace, /^  multer@2\.0\.2: 2\.2\.0$/m);
  assert.match(workspace, /^  next@15\.5\.22>postcss: 8\.5\.26$/m);
  assert.match(workspace, /^  sharp@0\.34\.5: 0\.35\.0$/m);
  assert.match(workspace, /^allowBuilds:\n  esbuild: true$/m);
  assert.doesNotMatch(workspace, /^dangerouslyAllowAllBuilds:\s*true$/m);
});

test('Docker builds before production deploy packaging', () => {
  assert.match(dockerfile, /^ENV CI=true$/m);
  assert.match(
    dockerfile,
    /FROM pnpm-base AS build\nARG NEXT_PUBLIC_CLOUD_API_URL\nARG RELEASE_COMMIT\nENV CI=true\nENV NEXT_PUBLIC_CLOUD_API_URL=\$NEXT_PUBLIC_CLOUD_API_URL\nENV RELEASE_COMMIT=\$RELEASE_COMMIT/,
  );
  const cloudBuild = dockerfile.indexOf('pnpm --filter @event-commerce/cloud-api... build');
  const edgeBuild = dockerfile.indexOf('pnpm --filter @event-commerce/event-edge... build');
  const controlBuild = dockerfile.indexOf('pnpm --filter @event-commerce/control-web build');
  const cloudDeploy = dockerfile.indexOf(
    'pnpm --filter @event-commerce/cloud-api --prod deploy --legacy /out/cloud-api',
  );
  const edgeDeploy = dockerfile.indexOf(
    'pnpm --filter @event-commerce/event-edge --prod deploy --legacy /out/event-edge',
  );
  assert.ok(cloudBuild >= 0 && edgeBuild > cloudBuild && controlBuild > edgeBuild);
  assert.ok(cloudDeploy > controlBuild && edgeDeploy > cloudDeploy);
});

test('managed build scripts do not depend on pnpm being on PATH', () => {
  assert.equal(packageJson.scripts?.build, 'node scripts/hostinger-aware-build.mjs');
  assert.match(packageJson.scripts?.['hostinger:cloud-api:build'] ?? '', /^corepack pnpm /);
  assert.match(packageJson.scripts?.['hostinger:cloud-api:start'] ?? '', /^corepack pnpm /);
  assert.match(packageJson.scripts?.['hostinger:control-web:build'] ?? '', /^corepack pnpm /);
});

test('managed Event Control exports static files instead of requiring a Next runtime', () => {
  assert.equal(controlWebPackageJson.scripts?.build, 'next build');
  assert.match(controlWebConfig, /output: 'export'/);
  assert.match(controlWebConfig, /output: 'standalone'/);
  assert.match(controlWebConfig, /HOSTINGER_APP_TARGET === undefined/);
  assert.match(controlWebConfig, /trailingSlash: true/);
  assert.match(controlWebHtaccess, /Header always set X-Frame-Options "DENY"/);
  assert.match(managedReadme, /Output directory: out/);
  assert.match(managedReadme, /no Next\.js server process/);
});

test('root entry remains available for managed server-side targets', () => {
  assert.equal(packageJson.main, 'server.js');
  assert.equal(packageJson.scripts?.start, 'node server.js');
  assert.match(hostingerEntry, /process\.env\.PORT \?\? '3000'/);
  assert.match(hostingerEntry, /hostname = '0\.0\.0\.0'/);
});

test('managed Cloud API migrates before startup', () => {
  assert.equal(
    packageJson.scripts?.['hostinger:cloud-api:build'],
    'corepack pnpm --filter @event-commerce/cloud-api... build',
  );
  const start = packageJson.scripts?.['hostinger:cloud-api:start'];
  const expected = [
    'corepack pnpm --filter @event-commerce/cloud-api db:migrate',
    'corepack pnpm --filter @event-commerce/cloud-api start',
  ].join(' && ');
  assert.equal(start, expected);
  assert.ok(start.indexOf('db:migrate') < start.indexOf(' start'));
});

test('managed Cloud API supports Hostinger Supabase integration', () => {
  assert.equal(cloudApiPackageJson.dependencies?.['@supabase/supabase-js'], '^2.0.0');
  assert.equal(cloudApiPackageJson.scripts?.['supabase:check'], 'node db.js');
  assert.match(supabaseHelper, /process\.env\.SUPABASE_URL/);
  assert.match(supabaseHelper, /from\('organisations'\)/);
  assert.doesNotMatch(supabaseHelper, /NEXT_PUBLIC_/);
});

test('managed API example stays PostgreSQL and sandbox only', () => {
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

test('managed Event Control uses the public API origin', () => {
  assert.match(controlEnv, /^NEXT_PUBLIC_CLOUD_API_URL=https:\/\/api\.pilot\.example\.com$/m);
});

test('managed docs preserve the venue-local Edge boundary', () => {
  assert.match(managedReadme, /Event Control Web \(static Next\.js export\)/);
  assert.match(managedReadme, /external PostgreSQL/);
  assert.match(managedReadme, /Event Edge remains venue-local/);
  assert.match(managedReadme, /20,000-attendee capacity evidence/);
});
