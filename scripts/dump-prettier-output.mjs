import { readFile } from 'node:fs/promises';
import prettier from 'prettier';

const files = [
  'apps/cloud-api/scripts/migrate.mjs',
  'apps/cloud-api/src/configuration/configuration.controller.ts',
  'apps/cloud-api/src/configuration/configuration.service.ts',
  'apps/cloud-api/src/configuration/validation.ts',
  'apps/cloud-api/test/configuration.integration.test.ts',
  'apps/control-web/src/app/configuration/configuration-client.tsx',
  'apps/control-web/src/app/layout.tsx',
  'apps/control-web/src/app/page.tsx',
  'apps/event-edge/src/main.ts',
  'packages/contracts/test/health.test.ts',
];

let changed = false;
for (const file of files) {
  const source = await readFile(file, 'utf8');
  const config = (await prettier.resolveConfig(file)) ?? {};
  const formatted = await prettier.format(source, { ...config, filepath: file });
  if (formatted !== source) changed = true;
  console.log(`@@FORMATTED:${file}@@`);
  console.log(Buffer.from(formatted, 'utf8').toString('base64'));
  console.log(`@@END:${file}@@`);
}

if (changed) {
  console.error('Canonical Prettier output differs from committed source.');
  process.exitCode = 1;
}
