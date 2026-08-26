import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const sourceUrl = new URL(
  '../src/app/event-close/event-close-client.tsx',
  import.meta.url,
);

describe('event close browser authentication', () => {
  it('uses the operator cookie session for close review, actions and exports', async () => {
    const source = await readFile(sourceUrl, 'utf8');

    expect(source).toContain("credentials: 'include'");
    expect(source).toContain("'x-event-control-request': 'browser'");
    expect(source).toContain("'x-organisation-id': organisationId");
  });

  it('does not synthesize privileged operator identity headers', async () => {
    const source = await readFile(sourceUrl, 'utf8');

    expect(source).not.toContain("'x-actor-id'");
    expect(source).not.toContain("'x-role'");
    expect(source).not.toContain('actorId = useMemo');
  });

  it('follows authenticated Event Control context instead of accepting raw IDs', async () => {
    const source = await readFile(sourceUrl, 'utf8');

    expect(source).toContain('eventControlContextChangedEvent');
    expect(source).toContain('readEventControlContext()');
    expect(source).toContain('<OperatorContextSwitcher />');
    expect(source).not.toContain('placeholder="Organisation ID"');
    expect(source).not.toContain('placeholder="Event ID"');
  });

  it('keeps random UUIDs only for idempotent close action IDs', async () => {
    const source = await readFile(sourceUrl, 'utf8');

    expect(source).toContain('actionId: `${kind}:${crypto.randomUUID()}`');
    expect(source).not.toContain("'x-actor-id': crypto.randomUUID()");
  });
});
