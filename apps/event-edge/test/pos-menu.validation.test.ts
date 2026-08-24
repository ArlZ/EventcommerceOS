import { describe, expect, it } from 'vitest';
import { parsePosMenuSnapshot, posMenuChecksum } from '../src/pos-menu/pos-menu.validation';

const base = {
  eventId: 'dev-event-offline',
  salesLocationId: 'sales-1',
  menuId: 'dev-menu-v1',
  version: 1,
  activatedAtEpochMs: 1_700_000_000_000,
  sourceActor: 'built-in-task003',
  currency: 'KES',
  items: [
    {
      itemId: 'dev-tusker-500',
      skuId: 'sku-tusker-500',
      name: 'Tusker 500ml',
      category: 'Beer',
      priceMinor: 25_000,
      favourite: true,
      sortOrder: 10,
    },
    {
      itemId: 'dev-whitecap-500',
      skuId: 'sku-whitecap-500',
      name: 'White Cap 500ml',
      category: 'Beer',
      priceMinor: 30_000,
      favourite: true,
      sortOrder: 20,
    },
    {
      itemId: 'dev-water-500',
      skuId: 'sku-water-500',
      name: 'Water 500ml',
      category: 'Soft Drinks',
      priceMinor: 10_000,
      favourite: true,
      sortOrder: 30,
    },
    {
      itemId: 'dev-soda-300',
      skuId: 'sku-soda-300',
      name: 'Soda 300ml',
      category: 'Soft Drinks',
      priceMinor: 15_000,
      favourite: false,
      sortOrder: 40,
    },
  ],
};

describe('POS menu snapshot validation', () => {
  it('matches the Android MenuIntegrity CRC32 canonicalization', () => {
    expect(posMenuChecksum(base)).toBe('01776b48');
    expect(parsePosMenuSnapshot({ ...base, checksum: '01776b48' }).checksum).toBe('01776b48');
  });

  it('rejects changed content with a stale checksum', () => {
    expect(() =>
      parsePosMenuSnapshot({
        ...base,
        checksum: '01776b48',
        items: base.items.map((item, index) =>
          index === 0 ? { ...item, priceMinor: 99_999 } : item,
        ),
      }),
    ).toThrow('menu checksum does not match content');
  });

  it('rejects duplicate item and SKU identities', () => {
    const first = base.items[0]!;
    const duplicated = [...base.items, { ...first, itemId: 'another-id' }];
    const unsigned = { ...base, items: duplicated };
    expect(() =>
      parsePosMenuSnapshot({ ...unsigned, checksum: posMenuChecksum(unsigned) }),
    ).toThrow('duplicate menu item sku id');
  });
});
