import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { EdgeDatabaseService } from '../src/database/database.service';
import { PosMenuService } from '../src/pos-menu/pos-menu.service';
import type { PosMenuSnapshot } from '../src/pos-menu/pos-menu.types';

const snapshot: PosMenuSnapshot = {
  eventId: 'event-1',
  salesLocationId: 'bar-1',
  menuId: 'menu-1',
  version: 2,
  activatedAtEpochMs: 1_700_000_000_000,
  sourceActor: 'operator-1',
  currency: 'KES',
  checksum: '01776b48',
  items: [
    {
      itemId: 'item-1',
      skuId: 'sku-1',
      name: 'Water',
      category: 'Soft Drinks',
      priceMinor: 10_000,
      favourite: true,
      sortOrder: 10,
    },
  ],
};

function row(candidate: PosMenuSnapshot) {
  return {
    version: candidate.version.toString(),
    checksum: candidate.checksum,
    payload: candidate,
  };
}

function transactionalDatabase(existing?: PosMenuSnapshot) {
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: existing ? [row(existing)] : [] })
    .mockResolvedValueOnce({ rows: [row(snapshot)] });
  const database = {
    transaction: async <T>(operation: (client: { query: typeof query }) => Promise<T>) =>
      operation({ query }),
  } as unknown as EdgeDatabaseService;
  return { database, query };
}

describe('PosMenuService', () => {
  it('serializes installs before reading the current snapshot', async () => {
    const { database, query } = transactionalDatabase();
    const service = new PosMenuService(database);

    await service.install(snapshot);

    expect(query.mock.calls[0]?.[0]).toContain('pg_advisory_xact_lock');
    expect(query.mock.calls[0]?.[1]).toEqual(['pos-menu:event-1:bar-1']);
  });

  it('rejects rollback to an older menu snapshot version', async () => {
    const newer = { ...snapshot, version: 3 };
    const { database, query } = transactionalDatabase(newer);
    const service = new PosMenuService(database);

    await expect(service.install(snapshot)).rejects.toBeInstanceOf(ConflictException);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('treats the same version and checksum as idempotent', async () => {
    const existing = { ...snapshot };
    const { database, query } = transactionalDatabase(existing);
    const service = new PosMenuService(database);

    await expect(service.install(snapshot)).resolves.toEqual(existing);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('rejects content drift when a version is reused', async () => {
    const existing = { ...snapshot, checksum: 'aaaaaaaa' };
    const { database, query } = transactionalDatabase(existing);
    const service = new PosMenuService(database);

    await expect(service.install(snapshot)).rejects.toBeInstanceOf(ConflictException);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('installs a strictly newer version', async () => {
    const older = { ...snapshot, version: 1, checksum: 'bbbbbbbb' };
    const { database, query } = transactionalDatabase(older);
    const service = new PosMenuService(database);

    await expect(service.install(snapshot)).resolves.toEqual(snapshot);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('returns the current scoped snapshot and fails closed when absent', async () => {
    const database = {
      query: vi
        .fn()
        .mockResolvedValueOnce([row(snapshot)])
        .mockResolvedValueOnce([]),
    } as unknown as EdgeDatabaseService;
    const service = new PosMenuService(database);

    await expect(service.current('event-1', 'bar-1')).resolves.toEqual(snapshot);
    await expect(service.current('event-1', 'bar-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
