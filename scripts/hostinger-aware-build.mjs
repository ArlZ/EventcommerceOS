import { existsSync } from 'node:fs';
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
  verifyControlWebStaticExport();
}

process.exit(0);

function verifyControlWebStaticExport() {
  const outputRoot = resolve('apps/control-web/out');
  const index = resolve(outputRoot, 'index.html');
  const htaccess = resolve(outputRoot, '.htaccess');

  if (!existsSync(index)) {
    console.error(`Managed Control Web static export was not generated at ${index}`);
    process.exit(1);
  }
  if (!existsSync(htaccess)) {
    console.error(`Managed Control Web security rules were not exported at ${htaccess}`);
    process.exit(1);
  }

  console.log(`Verified managed Event Control static export at ${outputRoot}`);
}
