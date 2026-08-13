import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';

const root = process.cwd();
const sourceExtensions = new Set(['.ts', '.tsx']);
const ignoredDirectories = new Set(['node_modules', 'dist', '.next', 'coverage', 'build', '.gradle']);
const violations = [];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (sourceExtensions.has(extname(entry.name))) files.push(path);
  }
  return files;
}

function importsOf(source) {
  const imports = [];
  const expression = /(?:import|export)\s+(?:[^'\"]*?\s+from\s+)?['\"]([^'\"]+)['\"]/g;
  for (const match of source.matchAll(expression)) imports.push(match[1]);
  return imports;
}

function resolvesInside(specifier, file, directory) {
  if (!specifier.startsWith('.')) return false;
  const target = resolve(dirname(file), specifier);
  return target === directory || target.startsWith(directory + sep);
}

const appRoots = ['cloud-api', 'control-web', 'event-edge'];
const appDirectories = new Map(appRoots.map((name) => [name, join(root, 'apps', name)]));

const packageRoots = ['domain', 'contracts', 'observability', 'testkit'];
for (const packageName of packageRoots) {
  const directory = join(root, 'packages', packageName);
  for (const file of await walk(directory)) {
    const source = await readFile(file, 'utf8');
    for (const specifier of importsOf(source)) {
      const importsAppAlias = appRoots.some((name) => specifier === `@event-commerce/${name}` || specifier.startsWith(`@event-commerce/${name}/`));
      const importsAppRelatively = [...appDirectories.values()].some((appDirectory) => resolvesInside(specifier, file, appDirectory));
      if (importsAppAlias || importsAppRelatively) {
        violations.push(`${relative(root, file)} imports application code: ${specifier}`);
      }
      if (packageName === 'domain' && (specifier.startsWith('@nestjs/') || specifier === 'next' || specifier.startsWith('next/') || specifier === 'react' || specifier.startsWith('react/'))) {
        violations.push(`${relative(root, file)} couples domain code to framework: ${specifier}`);
      }
    }
  }
}

for (const appName of appRoots) {
  const directory = appDirectories.get(appName);
  const otherApps = appRoots.filter((name) => name !== appName);
  for (const file of await walk(directory)) {
    const source = await readFile(file, 'utf8');
    for (const specifier of importsOf(source)) {
      const importsOtherAlias = otherApps.some((name) => specifier === `@event-commerce/${name}` || specifier.startsWith(`@event-commerce/${name}/`));
      const importsOtherRelatively = otherApps.some((name) => resolvesInside(specifier, file, appDirectories.get(name)));
      if (importsOtherAlias || importsOtherRelatively) {
        violations.push(`${relative(root, file)} imports another app directly: ${specifier}`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error('Architecture boundary violations:\n' + violations.map((item) => `- ${item}`).join('\n'));
  process.exit(1);
}

console.log('Architecture dependency guardrails passed.');
