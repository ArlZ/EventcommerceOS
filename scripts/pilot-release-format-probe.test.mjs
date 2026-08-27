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
    console.log(`PILOT_RELEASE_FORMAT_BEGIN:${path}\n${formatted}\nPILOT_RELEASE_FORMAT_END:${path}`);
    if (source !== formatted) mismatches.push(path);
  }
  if (mismatches.length) throw new Error(`${mismatches.join(', ')} not formatted`);
});
