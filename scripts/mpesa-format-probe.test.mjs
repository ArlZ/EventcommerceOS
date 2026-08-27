import { readFile } from 'node:fs/promises';
import { format } from 'prettier';
import test from 'node:test';

const files = ['./scripts/mpesa-sandbox-evidence.mjs', './scripts/mpesa-sandbox-evidence.test.mjs'];

test('prints M-PESA evidence Prettier output', async () => {
  for (const path of files) {
    const source = await readFile(path, 'utf8');
    const formatted = await format(source, {
      parser: 'babel',
      singleQuote: true,
      trailingComma: 'all',
      printWidth: 100,
    });
    console.log(`MPESA_FORMAT_BEGIN:${path}\n${formatted}\nMPESA_FORMAT_END:${path}`);
    if (source !== formatted) throw new Error(`${path} is not formatted`);
  }
});
