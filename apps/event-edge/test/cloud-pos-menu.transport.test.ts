import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudPosMenuTransport } from '../src/pos-menu/cloud-pos-menu.transport';
import { posMenuChecksum } from '../src/pos-menu/pos-menu.validation';

const eventId = '11111111-1111-4111-8111-111111111111';
const unsigned = {
  eventId,
  menuId: '22222222-2222-4222-8222-222222222222',
  version: 1,
  activatedAtEpochMs: 1_700_000_000_000,
  sourceActor: '33333333-3333-4333-8333-333333333333',
  currency: 'KES',
  items: [
    {
      itemId: '44444444-4444-4444-8444-444444444444',
      skuId: '55555555-5555-4555-8555-555555555555',
      name: 'Water',
      category: 'Soft Drinks',
      priceMinor: 10_000,
      favourite: false,
      sortOrder: 10,
    },
  ],
};
const snapshot = {
  ...unsigned,
  salesLocationId: '66666666-6666-4666-8666-666666666666',
  checksum: posMenuChecksum(unsigned),
};

const originalCloudSyncUrl = process.env.CLOUD_SYNC_URL;
const originalEdgeId = process.env.EDGE_ID;
const originalToken = process.env.EDGE_CLOUD_SYNC_TOKEN;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalCloudSyncUrl === undefined) delete process.env.CLOUD_SYNC_URL;
  else process.env.CLOUD_SYNC_URL = originalCloudSyncUrl;
  if (originalEdgeId === undefined) delete process.env.EDGE_ID;
  else process.env.EDGE_ID = originalEdgeId;
  if (originalToken === undefined) delete process.env.EDGE_CLOUD_SYNC_TOKEN;
  else process.env.EDGE_CLOUD_SYNC_TOKEN = originalToken;
});

describe('CloudPosMenuTransport', () => {
  it('derives the publication endpoint from the configured Cloud sync authority', () => {
    process.env.CLOUD_SYNC_URL = 'https://api.example.test/sync/edge-events';
    const transport = new CloudPosMenuTransport();

    expect(transport.endpoint(eventId)).toBe(
      `https://api.example.test/sync/events/${eventId}/pos-menu-publications`,
    );
  });

  it('refuses non-HTTPS non-loopback Cloud origins', () => {
    process.env.CLOUD_SYNC_URL = 'http://api.example.test/sync/edge-events';
    const transport = new CloudPosMenuTransport();

    expect(() => transport.endpoint(eventId)).toThrow('must use HTTPS');
  });

  it('authenticates as the Edge and validates every returned snapshot before install', async () => {
    process.env.CLOUD_SYNC_URL = 'https://api.example.test/sync/edge-events';
    process.env.EDGE_ID = 'edge-pilot';
    process.env.EDGE_CLOUD_SYNC_TOKEN = 'x'.repeat(48);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [snapshot],
    });
    vi.stubGlobal('fetch', fetchMock);
    const transport = new CloudPosMenuTransport();

    await expect(transport.latest(eventId)).resolves.toEqual([snapshot]);
    const request = fetchMock.mock.calls[0];
    expect(request?.[0]).toBe(
      `https://api.example.test/sync/events/${eventId}/pos-menu-publications`,
    );
    expect(request?.[1]?.headers).toMatchObject({
      'x-edge-id': 'edge-pilot',
      authorization: `Bearer ${'x'.repeat(48)}`,
    });
  });

  it('fails closed if Cloud returns a snapshot with an invalid checksum', async () => {
    process.env.CLOUD_SYNC_URL = 'https://api.example.test/sync/edge-events';
    process.env.EDGE_ID = 'edge-pilot';
    process.env.EDGE_CLOUD_SYNC_TOKEN = 'x'.repeat(48);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [{ ...snapshot, checksum: '00000000' }],
      }),
    );
    const transport = new CloudPosMenuTransport();

    await expect(transport.latest(eventId)).rejects.toThrow('checksum does not match content');
  });

  it('fails closed if Cloud returns a valid snapshot from another event scope', async () => {
    process.env.CLOUD_SYNC_URL = 'https://api.example.test/sync/edge-events';
    process.env.EDGE_ID = 'edge-pilot';
    process.env.EDGE_CLOUD_SYNC_TOKEN = 'x'.repeat(48);
    const otherUnsigned = {
      ...unsigned,
      eventId: '77777777-7777-4777-8777-777777777777',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            ...snapshot,
            eventId: otherUnsigned.eventId,
            checksum: posMenuChecksum(otherUnsigned),
          },
        ],
      }),
    );
    const transport = new CloudPosMenuTransport();

    await expect(transport.latest(eventId)).rejects.toThrow('escaped the requested event scope');
  });
});
