import { readFile } from 'node:fs/promises';
import * as prettier from 'prettier';

const targets = [
  "apps/cloud-api/src/command-centre/command-centre.service.ts",
  "apps/cloud-api/src/sync/device-operational-status.ts",
  "apps/cloud-api/test/device-operational-status.test.ts",
  "apps/control-web/src/app/command-centre/command-centre-client.tsx",
  "apps/control-web/src/app/event-close/event-close-client.tsx",
  "apps/control-web/src/app/sync-health/sync-health-client.tsx"
];
const chunkSize = 1800;

for (const filepath of targets) {
  const source = await readFile(filepath, 'utf8');
  const config = (await prettier.resolveConfig(filepath)) ?? {};
  const formatted = await prettier.format(source, { ...config, filepath });
  const encoded = Buffer.from(formatted, 'utf8').toString('base64');
  console.log(`FORMAT_FILE_BEGIN ${filepath}`);
  for (let offset = 0, index = 0; offset < encoded.length; offset += chunkSize, index += 1) {
    console.log(`FORMAT_CHUNK ${filepath} ${String(index).padStart(4, '0')} ${encoded.slice(offset, offset + chunkSize)}`);
  }
  console.log(`FORMAT_FILE_END ${filepath}`);
}

process.exitCode = 1;
