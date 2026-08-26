import { readFile } from 'node:fs/promises';
import { format } from 'prettier';
import { expect, it } from 'vitest';

it('prints command centre auth test formatting', async () => {
  const url = new URL('./command-centre-auth.test.ts', import.meta.url);
  const source = await readFile(url, 'utf8');
  const formatted = await format(source, {
    parser: 'typescript',
    singleQuote: true,
    trailingComma: 'all',
    printWidth: 100,
  });
  console.log(`AUTH_FORMAT_BEGIN\n${formatted}\nAUTH_FORMAT_END`);
  expect(source).toBe(formatted);
});
