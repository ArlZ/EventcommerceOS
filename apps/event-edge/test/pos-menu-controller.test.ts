import { describe, expect, it, vi } from 'vitest';
import { PosMenuController } from '../src/pos-menu/pos-menu.controller';
import type { PosMenuSnapshot } from '../src/pos-menu/pos-menu.types';

const eventId = '11111111-1111-4111-8111-111111111111';
const snapshot = {
  eventId,
  salesLocationId: '22222222-2222-4222-8222-222222222222',
  menuId: '33333333-3333-4333-8333-333333333333',
  version: 1,
  activatedAtEpochMs: 1_700_000_000_000,
  sourceActor: '44444444-4444-4444-8444-444444444444',
  currency: 'KES',
  checksum: '1234abcd',
  items: [],
} satisfies PosMenuSnapshot;

describe('PosMenuController pull', () => {
  it('acknowledges Cloud only after the local batch install succeeds', async () => {
    const order: string[] = [];
    const localAdmin = { authorize: vi.fn(() => order.push('authorize')) };
    const deviceAuth = { authenticate: vi.fn() };
    const menus = {
      install: vi.fn(),
      current: vi.fn(),
      installBatch: vi.fn(async () => {
        order.push('install');
        return [snapshot];
      }),
    };
    const cloudMenus = {
      latest: vi.fn(async () => {
        order.push('fetch');
        return [snapshot];
      }),
      acknowledgeInstalled: vi.fn(async () => {
        order.push('acknowledge');
      }),
    };
    const controller = new PosMenuController(
      localAdmin as never,
      deviceAuth as never,
      menus as never,
      cloudMenus as never,
    );

    await expect(controller.pull({}, eventId)).resolves.toEqual([snapshot]);
    expect(order).toEqual(['authorize', 'fetch', 'install', 'acknowledge']);
    expect(cloudMenus.acknowledgeInstalled).toHaveBeenCalledWith(eventId, [snapshot]);
  });

  it('never acknowledges Cloud when the local transaction fails', async () => {
    const localAdmin = { authorize: vi.fn() };
    const deviceAuth = { authenticate: vi.fn() };
    const menus = {
      install: vi.fn(),
      current: vi.fn(),
      installBatch: vi.fn().mockRejectedValue(new Error('local commit failed')),
    };
    const cloudMenus = {
      latest: vi.fn().mockResolvedValue([snapshot]),
      acknowledgeInstalled: vi.fn(),
    };
    const controller = new PosMenuController(
      localAdmin as never,
      deviceAuth as never,
      menus as never,
      cloudMenus as never,
    );

    await expect(controller.pull({}, eventId)).rejects.toThrow('local commit failed');
    expect(cloudMenus.acknowledgeInstalled).not.toHaveBeenCalled();
  });
});
