import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const appRoot = process.cwd();
const standaloneRoot = resolve(appRoot, '.next/standalone');
const staticSource = resolve(appRoot, '.next/static');
const publicSource = resolve(appRoot, 'public');

const runtimeRoots = [resolve(standaloneRoot, 'apps/control-web'), standaloneRoot].filter((root) =>
  existsSync(resolve(root, 'server.js')),
);

if (runtimeRoots.length === 0) {
  throw new Error(`Next standalone server was not generated under ${standaloneRoot}`);
}

if (!existsSync(staticSource)) {
  throw new Error(`Next static assets were not generated at ${staticSource}`);
}

for (const runtimeRoot of runtimeRoots) {
  const staticDestination = resolve(runtimeRoot, '.next/static');
  rmSync(staticDestination, { recursive: true, force: true });
  mkdirSync(resolve(runtimeRoot, '.next'), { recursive: true });
  cpSync(staticSource, staticDestination, { recursive: true });

  if (existsSync(publicSource)) {
    const publicDestination = resolve(runtimeRoot, 'public');
    rmSync(publicDestination, { recursive: true, force: true });
    cpSync(publicSource, publicDestination, { recursive: true });
  }
}

console.log(`Staged standalone Event Control assets in ${runtimeRoots.join(', ')}`);
