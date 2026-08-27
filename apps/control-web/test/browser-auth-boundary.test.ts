import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const appRoot = fileURLToPath(new URL('../src/app/', import.meta.url));

describe('browser operator identity boundary', () => {
  it('never synthesizes actor or role headers in Control Web source', async () => {
    const entries = await readdir(appRoot, { recursive: true });
    const sourceFiles = entries.filter(
      (entry) => typeof entry === 'string' && (entry.endsWith('.ts') || entry.endsWith('.tsx')),
    );

    const violations: string[] = [];
    for (const entry of sourceFiles) {
      const source = await readFile(`${appRoot}/${entry}`, 'utf8');
      if (/['"]x-actor-id['"]\s*:/.test(source) || /['"]x-role['"]\s*:/.test(source)) {
        violations.push(entry);
      }
    }

    expect(violations).toEqual([]);
  });
});
