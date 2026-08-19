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
  env: process.env,
  stdio: 'inherit',
});

if (result.error) {
  console.error('Failed to invoke Corepack for the build', result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
