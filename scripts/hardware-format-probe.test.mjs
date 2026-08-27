import { readFile } from 'node:fs/promises';
import { format } from 'prettier';
import test from 'node:test';

test('prints hardware network Prettier output', async () => {
  const path = './scripts/hardware-network-evidence.mjs';
  const source = await readFile(path, 'utf8');
  const formatted = await format(source, {
    parser: 'babel',
    singleQuote: true,
    trailingComma: 'all',
    printWidth: 100,
  });
  console.log(`HARDWARE_FORMAT_BEGIN\n${formatted}\nHARDWARE_FORMAT_END`);
  if (source !== formatted) throw new Error('hardware network evidence is not formatted');
});
