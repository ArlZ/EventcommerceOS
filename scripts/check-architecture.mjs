import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';

const root = process.cwd();
const sourceExtensions = new Set(['.ts', '.tsx']);
const violations = [];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
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

const packageRoots = ['domain', 'contracts', 'observability', 'testkit'];
for (const packageName of packageRoots) {
  const directory = join(root, 'packages', packageName);
  for (const file of await walk(directory)) {
    const source = await readFile(file, 'utf8');
    for (const specifier of importsOf(source)) {
      if (specifier.includes('/apps/') || specifier.startsWith('@event-commerce/cloud-api') || specifier.startsWith('@event-commerce/event-edge') || specifier.startsWith('@event-commerce/control-web')) {
        violations.push(`${relative(root, file)} imports application code: ${specifier}`);
      }
      if (packageName === 'domain' && (specifier.startsWith('@nestjs/') || specifier === 'next' || specifier.startsWith('next/') || specifier === 'react')) {
        violations.push(`${relative(root, file)} couples domain code to framework: ${specifier}`);
      }
    }
  }
}

const appRoots = ['cloud-api', 'control-web', 'event-edge'];
for (const appName of appRoots) {
  const directory = join(root, 'apps', appName);
  for (const file of await walk(directory)) {
    const source = await readFile(file, 'utf8');
    for (const specifier of importsOf(source)) {
      const normalized = specifier.split('/').join(sep);
      if (normalized.includes(`${sep}apps${sep}`)) {
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
