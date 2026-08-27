import { readFile } from 'node:fs/promises';
import { format } from 'prettier';
import test from 'node:test';

const files = ['./scripts/pilot-release-review.mjs', './scripts/pilot-release-review.test.mjs'];

test('prints pilot release review Prettier output', async () => {
  const mismatches = [];
  for (const path of files) {
    const source = await readFile(path, 'utf8');
    const formatted = await format(source, {
      parser: 'babel',
      singleQuote: true,
      trailingComma: 'all',
      printWidth: 100,
    });
    const encoded = Buffer.from(formatted, 'utf8').toString('base64');
    console.log(`PILOT_RELEASE_FORMAT_BASE64:${path}:${encoded}`);
    if (source !== formatted) mismatches.push(path);
  }
  if (mismatches.length) throw new Error(`${mismatches.join(', ')} not formatted`);
});
