import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const sourceUrl = new URL('../src/app/event-schedule/event-schedule-client.tsx', import.meta.url);

describe('event schedule browser authentication', () => {
  it('uses the operator cookie session and browser request marker', async () => {
    const source = await readFile(sourceUrl, 'utf8');

    expect(source).toContain("credentials: 'include'");
    expect(source).toContain("'x-event-control-request': 'browser'");
    expect(source).toContain("'x-organisation-id': organisationId");
  });

  it('does not synthesize privileged operator identity headers', async () => {
    const source = await readFile(sourceUrl, 'utf8');

    expect(source).not.toContain("'x-actor-id'");
    expect(source).not.toContain("'x-role'");
    expect(source).not.toContain('crypto.randomUUID()');
  });
});
