import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { format } from 'prettier';

describe('readiness client format probe', () => {
  it('matches Prettier output', async () => {
    const path = new URL('../src/app/readiness/readiness-client.tsx', import.meta.url);
    const source = await readFile(path, 'utf8');
    const formatted = await format(source, { parser: 'typescript' });
    expect(source).toBe(formatted);
  });
});
