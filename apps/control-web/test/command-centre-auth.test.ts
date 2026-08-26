import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const sourceUrl = new URL('../src/app/command-centre/command-centre-client.tsx', import.meta.url);

describe('command centre browser authentication', () => {
  it('uses the operator cookie session for snapshot, stream and actions', async () => {
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

  it('uses the authenticated Event Control selector instead of raw IDs', async () => {
    const source = await readFile(sourceUrl, 'utf8');

    expect(source).toContain('eventControlContextChangedEvent');
    expect(source).toContain('readEventControlContext()');
    expect(source).toContain('<OperatorContextSwitcher />');
    expect(source).not.toContain('placeholder="Organisation ID"');
    expect(source).not.toContain('placeholder="Event ID"');
  });

  it('does not send an assignee chosen by the browser', async () => {
    const source = await readFile(sourceUrl, 'utf8');

    expect(source).toContain("body: JSON.stringify({ action })");
    expect(source).not.toContain('assignedActorId: actorId');
  });
});
