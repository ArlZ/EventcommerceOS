import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { format, resolveConfig } from 'prettier';

describe('operator context switcher format probe', () => {
  it('matches repository Prettier output', async () => {
    const path = new URL('../src/app/operator-context-switcher.tsx', import.meta.url);
    const source = await readFile(path, 'utf8');
    const config = (await resolveConfig(path.pathname)) ?? {};
    const formatted = await format(source, { ...config, parser: 'typescript' });
    expect(source).toBe(formatted);
  });
});
