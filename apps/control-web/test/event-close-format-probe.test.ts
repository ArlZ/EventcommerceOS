import { readFile } from 'node:fs/promises';
import { format } from 'prettier';
import { expect, it } from 'vitest';

it('prints event close formatting', async () => {
  const url = new URL('../src/app/event-close/event-close-client.tsx', import.meta.url);
  const source = await readFile(url, 'utf8');
  const formatted = await format(source, {
    parser: 'typescript',
    singleQuote: true,
    trailingComma: 'all',
    printWidth: 100,
  });
  console.log(`EVENT_CLOSE_FORMAT_BEGIN\n${formatted}\nEVENT_CLOSE_FORMAT_END`);
  expect(source).toBe(formatted);
});
