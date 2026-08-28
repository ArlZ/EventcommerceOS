import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import * as prettier from 'prettier';

const targets = [
  "apps/cloud-api/src/command-centre/command-centre.service.ts",
  "apps/cloud-api/src/sync/device-operational-status.ts",
  "apps/cloud-api/test/device-operational-status.test.ts",
  "apps/control-web/src/app/command-centre/command-centre-client.tsx",
  "apps/control-web/src/app/event-close/event-close-client.tsx",
  "apps/control-web/src/app/sync-health/sync-health-client.tsx"
];

for (const filepath of targets) {
  const source = await readFile(filepath, 'utf8');
  const config = (await prettier.resolveConfig(filepath)) ?? {};
  const formatted = await prettier.format(source, { ...config, filepath });
  await writeFile(filepath, formatted, 'utf8');
}

const diff = execFileSync(
  'git',
  ['diff', '--no-ext-diff', '--unified=3', '--', ...targets],
  { encoding: 'utf8' },
);

console.log('FORMAT_PROBE_BEGIN');
console.log(diff);
console.log('FORMAT_PROBE_END');
process.exitCode = 1;
