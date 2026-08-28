import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { format } from 'prettier';

describe('command centre format diagnostic', () => {
  it('prints the first Prettier mismatch window', async () => {
    const path = new URL('../src/app/command-centre/command-centre-client.tsx', import.meta.url);
    const source = await readFile(path, 'utf8');
    const formatted = await format(source, {
      parser: 'typescript',
      singleQuote: true,
      trailingComma: 'all',
      printWidth: 100,
    });

    if (source !== formatted) {
      const sourceLines = source.split('\n');
      const formattedLines = formatted.split('\n');
      const firstDifference = sourceLines.findIndex((line, index) => line !== formattedLines[index]);
      const start = Math.max(0, firstDifference - 4);
      const end = Math.min(
        Math.max(sourceLines.length, formattedLines.length),
        firstDifference + 16,
      );
      console.log(
        JSON.stringify(
          {
            firstDifference: firstDifference + 1,
            source: sourceLines.slice(start, end),
            formatted: formattedLines.slice(start, end),
          },
          null,
          2,
        ),
      );
    }

    expect(true).toBe(true);
  });
});
