import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const eventId = '11111111-1111-4111-8111-111111111111';
const adminToken = 'x'.repeat(32);
const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

async function localServer(
  handler: Parameters<typeof createServer>[0],
): Promise<number> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server did not bind to TCP');
  return address.port;
}

describe('POS menu operator command', () => {
  it('pulls only through the loopback Event Edge admin endpoint and reports installed versions', async () => {
    let requestSeen = false;
    const port = await localServer((request, response) => {
      requestSeen = true;
      expect(request.method).toBe('POST');
      expect(request.url).toBe(`/pos-menu/pull/${eventId}`);
      expect(request.headers.authorization).toBe(`Bearer ${adminToken}`);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify([
          {
            eventId,
            salesLocationId: '22222222-2222-4222-8222-222222222222',
            version: 3,
            checksum: 'deadbeef',
            currency: 'KES',
            items: [],
          },
        ]),
      );
    });

    const result = await execFileAsync(process.execPath, ['scripts/manage-pos-menu.mjs', 'pull'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        POS_MENU_EVENT_ID: eventId,
        EDGE_LOCAL_ADMIN_TOKEN: adminToken,
        EDGE_LOCAL_ADMIN_PORT: String(port),
      },
    });

    expect(requestSeen).toBe(true);
    expect(result.stdout).toContain(`Installed 1 POS menu snapshot(s) for event ${eventId}.`);
    expect(result.stdout).toContain('version=3 checksum=deadbeef');
    expect(result.stdout).toContain('Cloud installation receipts were acknowledged');
    expect(result.stdout).not.toContain(adminToken);
  });

  it('rejects a weak local-admin credential before making a request', async () => {
    await expect(
      execFileAsync(process.execPath, ['scripts/manage-pos-menu.mjs', 'pull'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          POS_MENU_EVENT_ID: eventId,
          EDGE_LOCAL_ADMIN_TOKEN: 'too-short',
          EDGE_LOCAL_ADMIN_PORT: '3002',
        },
      }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('EDGE_LOCAL_ADMIN_TOKEN must contain at least 32 characters'),
    });
  });
});
