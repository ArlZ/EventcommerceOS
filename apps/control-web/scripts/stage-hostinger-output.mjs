import {
  cpSync,
  existsSync,
  lstatSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

if (process.env.HOSTINGER_APP_TARGET !== 'control-web') {
  console.log(
    'Skipping Hostinger portable runtime staging outside a Control Web Hostinger build',
  );
  process.exit(0);
}

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

// pnpm deploy creates relative links into node_modules/.pnpm. Preserve those
// link targets verbatim when moving the portable tree, otherwise Node's copy
// helper can rewrite them against the temporary deploy directory that is
// removed immediately afterwards.
cpSync(deployRoot, outputRoot, { recursive: true, verbatimSymlinks: true });
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
cpSync(nextSource, nextDestination, {
  recursive: true,
  verbatimSymlinks: true,
});

const publicSource = resolve(appRoot, 'public');
if (existsSync(publicSource)) {
  const publicDestination = resolve(outputRoot, 'public');
  rmSync(publicDestination, { recursive: true, force: true });
  cpSync(publicSource, publicDestination, {
    recursive: true,
    verbatimSymlinks: true,
  });
}

console.log(`Staged portable Hostinger Event Control runtime at ${outputRoot}`);

function ensureTopLevelPackageLink(packageName) {
  const nodeModulesRoot = resolve(outputRoot, 'node_modules');
  const topLevelPackage = resolve(nodeModulesRoot, packageName);
  if (existsSync(topLevelPackage)) return;

  if (pathEntryExists(topLevelPackage)) {
    const entry = lstatSync(topLevelPackage);
    if (!entry.isSymbolicLink()) {
      throw new Error(
        `Broken runtime package entry is not a symlink: ${topLevelPackage}`,
      );
    }
    unlinkSync(topLevelPackage);
  }

  const virtualStore = resolve(nodeModulesRoot, '.pnpm');
  let packageSource;

  if (existsSync(virtualStore)) {
    const prefix = `${packageName}@`;
    for (const entry of readdirSync(virtualStore)) {
      if (!entry.startsWith(prefix)) continue;
      const candidate = resolve(
        virtualStore,
        entry,
        'node_modules',
        packageName,
      );
      if (existsSync(candidate)) {
        packageSource = candidate;
        break;
      }
    }
  }

  if (!packageSource) {
    const hoistedPackage = resolve(virtualStore, 'node_modules', packageName);
    if (existsSync(hoistedPackage)) packageSource = hoistedPackage;
  }

  if (!packageSource) {
    throw new Error(
      `Portable deployment did not contain runtime package ${packageName}`,
    );
  }

  symlinkSync(relative(nodeModulesRoot, packageSource), topLevelPackage, 'dir');
}

function pathEntryExists(target) {
  try {
    lstatSync(target);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}
