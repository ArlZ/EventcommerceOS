import { readFile } from 'node:fs/promises';
import { format } from 'prettier';
import { describe, expect, it } from 'vitest';

const files = [
  '../src/app/command-centre/command-centre-client.tsx',
  './command-centre-auth.test.ts',
];

describe('command centre prettier probe', () => {
  it('prints repo-formatted sources', async () => {
    for (const relative of files) {
      const url = new URL(relative, import.meta.url);
      const source = await readFile(url, 'utf8');
      const formatted = await format(source, {
        parser: 'typescript',
        singleQuote: true,
        trailingComma: 'all',
        printWidth: 100,
      });
      console.log(`PRETTIER_BEGIN:${relative}\n${formatted}\nPRETTIER_END:${relative}`);
      expect(source).toBe(formatted);
    }
  });
});
