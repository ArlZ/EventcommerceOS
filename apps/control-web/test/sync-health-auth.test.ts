import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const sourceUrl = new URL('../src/app/sync-health/sync-health-client.tsx', import.meta.url);

describe('sync health browser authentication', () => {
  it('uses the operator cookie session and browser request marker', async () => {
    const source = await readFile(sourceUrl, 'utf8');

    expect(source).toContain("credentials: 'include'");
    expect(source).toContain("'x-event-control-request': 'browser'");
    expect(source).toContain("'x-organisation-id': activeOrganisationId");
  });

  it('follows authenticated Event Control context instead of accepting raw organisation IDs', async () => {
    const source = await readFile(sourceUrl, 'utf8');

    expect(source).toContain('eventControlContextChangedEvent');
    expect(source).toContain('readEventControlContext()');
    expect(source).toContain('<OperatorContextSwitcher />');
    expect(source).not.toContain('placeholder="Organisation ID"');
    expect(source).not.toContain('aria-label="Organisation ID"');
  });
});
