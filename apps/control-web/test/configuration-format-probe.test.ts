import { readFile } from 'node:fs/promises';
import { format } from 'prettier';
import { expect, it } from 'vitest';

const files = [
  '../src/app/configuration/configuration-client.tsx',
  '../src/app/configuration/page.tsx',
];

it('prints configuration Prettier output', async () => {
  for (const relative of files) {
    const url = new URL(relative, import.meta.url);
    const source = await readFile(url, 'utf8');
    const formatted = await format(source, {
      parser: 'typescript',
      singleQuote: true,
      trailingComma: 'all',
      printWidth: 100,
    });
    console.log(`CONFIG_FORMAT_BEGIN:${relative}\n${formatted}\nCONFIG_FORMAT_END:${relative}`);
    expect(source).toBe(formatted);
  }
});
