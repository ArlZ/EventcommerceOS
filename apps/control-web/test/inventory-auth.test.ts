import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const sourceUrl = new URL('../src/app/inventory/inventory-operations-client.tsx', import.meta.url);
const pageUrl = new URL('../src/app/inventory/page.tsx', import.meta.url);

describe('inventory browser authentication', () => {
  it('uses the operator cookie session and browser request marker', async () => {
    const source = await readFile(sourceUrl, 'utf8');

    expect(source).toContain("credentials: 'include'");
    expect(source).toContain("'x-event-control-request': 'browser'");
    expect(source).toContain("'x-organisation-id': scopedOrganisationId");
  });

  it('does not synthesize privileged operator identity headers', async () => {
    const source = await readFile(sourceUrl, 'utf8');

    expect(source).not.toContain("'x-actor-id'");
    expect(source).not.toContain("'x-role'");
    expect(source).not.toContain('crypto.randomUUID()');
  });

  it('follows authenticated Event Control context instead of accepting raw event IDs', async () => {
    const [source, page] = await Promise.all([
      readFile(sourceUrl, 'utf8'),
      readFile(pageUrl, 'utf8'),
    ]);

    expect(source).toContain('eventControlContextChangedEvent');
    expect(source).toContain('readEventControlContext()');
    expect(source).not.toContain('placeholder="Event ID"');
    expect(source).not.toContain('aria-label="Event ID"');
    expect(page).toContain('<OperatorContextSwitcher />');
  });

  it('fails closed when no authenticated event context is selected', async () => {
    const source = await readFile(sourceUrl, 'utf8');

    expect(source).toContain("setError('Select an organisation and event from Event Control.')");
    expect(source).toContain('if (!organisationId.trim() || !eventId.trim()) return;');
  });
});
