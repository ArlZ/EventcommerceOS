import { cpSync, existsSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const appRoot = process.cwd();
const repoRoot = resolve(appRoot, '../..');
const outputRoot = resolve(appRoot, '.hostinger-output');
const deployRoot = resolve(repoRoot, '.tmp-hostinger-control-web-deploy');

rmSync(outputRoot, { recursive: true, force: true });
rmSync(deployRoot, { recursive: true, force: true });

const deploy = spawnSync(
  'corepack',
  [
    'pnpm',
    '--filter',
    '@event-commerce/control-web',
    '--prod',
    'deploy',
    '--legacy',
    deployRoot,
  ],
  {
    cwd: repoRoot,
    env: { ...process.env, CI: 'true' },
    stdio: 'inherit',
  },
);

if (deploy.error) {
  throw deploy.error;
}
if (deploy.status !== 0) {
  process.exit(deploy.status ?? 1);
}

cpSync(deployRoot, outputRoot, { recursive: true });
rmSync(deployRoot, { recursive: true, force: true });

for (const packageName of ['next', 'react', 'react-dom']) {
  ensureTopLevelPackageLink(packageName);
}

const nextSource = resolve(appRoot, '.next');
const nextDestination = resolve(outputRoot, '.next');
if (!existsSync(nextSource)) {
  throw new Error(`Next build output was not generated at ${nextSource}`);
}
rmSync(nextDestination, { recursive: true, force: true });
cpSync(nextSource, nextDestination, { recursive: true });

const publicSource = resolve(appRoot, 'public');
if (existsSync(publicSource)) {
  const publicDestination = resolve(outputRoot, 'public');
  rmSync(publicDestination, { recursive: true, force: true });
  cpSync(publicSource, publicDestination, { recursive: true });
}

console.log(`Staged portable Hostinger Event Control runtime at ${outputRoot}`);

function ensureTopLevelPackageLink(packageName) {
  const nodeModulesRoot = resolve(outputRoot, 'node_modules');
  const topLevelPackage = resolve(nodeModulesRoot, packageName);
  if (existsSync(topLevelPackage)) return;

  const virtualStore = resolve(nodeModulesRoot, '.pnpm');
  const hoistedPackage = resolve(virtualStore, 'node_modules', packageName);
  let packageSource = existsSync(hoistedPackage) ? hoistedPackage : undefined;

  if (!packageSource && existsSync(virtualStore)) {
    const prefix = `${packageName}@`;
    for (const entry of readdirSync(virtualStore)) {
      if (!entry.startsWith(prefix)) continue;
      const candidate = resolve(virtualStore, entry, 'node_modules', packageName);
      if (existsSync(candidate)) {
        packageSource = candidate;
        break;
      }
    }
  }

  if (!packageSource) {
    throw new Error(`Portable deployment did not contain runtime package ${packageName}`);
  }

  symlinkSync(relative(nodeModulesRoot, packageSource), topLevelPackage, 'dir');
}
