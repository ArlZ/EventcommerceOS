import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const sourceUrl = new URL('../src/app/event-schedule/event-schedule-client.tsx', import.meta.url);
const pageUrl = new URL('../src/app/event-schedule/page.tsx', import.meta.url);

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

  it('follows the authenticated Event Control context instead of accepting raw organisation IDs', async () => {
    const [source, page] = await Promise.all([
      readFile(sourceUrl, 'utf8'),
      readFile(pageUrl, 'utf8'),
    ]);

    expect(source).toContain('eventControlContextChangedEvent');
    expect(source).toContain('readEventControlContext()');
    expect(source).not.toContain('placeholder="Organisation ID"');
    expect(source).not.toContain('aria-label="Organisation ID"');
    expect(page).toContain('<OperatorContextSwitcher />');
  });
});
