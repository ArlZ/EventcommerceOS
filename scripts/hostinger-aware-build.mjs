import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const target = process.env.HOSTINGER_APP_TARGET ?? 'all';

const argsByTarget = {
  'control-web': ['pnpm', '--filter', '@event-commerce/control-web...', 'build'],
  'cloud-api': ['pnpm', '--filter', '@event-commerce/cloud-api...', 'build'],
  all: ['pnpm', '-r', '--if-present', 'build'],
};

const args = argsByTarget[target];

if (!args) {
  console.error(`Unsupported HOSTINGER_APP_TARGET: ${target}`);
  process.exit(1);
}

console.log(`Building Event Commerce OS target: ${target}`);
const result = spawnSync('corepack', args, {
  env: { ...process.env, HOSTINGER_APP_TARGET: target },
  stdio: 'inherit',
});

if (result.error) {
  console.error('Failed to invoke Corepack for the build', result.error);
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

if (target === 'control-web') {
  stageControlWebStandaloneRuntime();
}

process.exit(0);

function stageControlWebStandaloneRuntime() {
  const appRoot = resolve('apps/control-web');
  const standaloneAppRoot = resolve(appRoot, '.next/standalone/apps/control-web');
  const standaloneServer = resolve(standaloneAppRoot, 'server.js');
  const staticSource = resolve(appRoot, '.next/static');
  const staticDestination = resolve(standaloneAppRoot, '.next/static');

  if (!existsSync(standaloneServer)) {
    console.error(`Next standalone server was not generated at ${standaloneServer}`);
    process.exit(1);
  }
  if (!existsSync(staticSource)) {
    console.error(`Next static assets were not generated at ${staticSource}`);
    process.exit(1);
  }

  rmSync(staticDestination, { recursive: true, force: true });
  mkdirSync(resolve(standaloneAppRoot, '.next'), { recursive: true });
  cpSync(staticSource, staticDestination, { recursive: true });

  const publicSource = resolve(appRoot, 'public');
  if (existsSync(publicSource)) {
    const publicDestination = resolve(standaloneAppRoot, 'public');
    rmSync(publicDestination, { recursive: true, force: true });
    cpSync(publicSource, publicDestination, { recursive: true });
  }

  console.log(`Staged self-contained Event Control runtime at ${standaloneAppRoot}`);
}
