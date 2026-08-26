import { describe, expect, it } from 'vitest';
import type { EventConfigurationView } from '@event-commerce/contracts';
import { evaluateEventReadiness } from '../src/app/readiness/readiness';

function fixture(): EventConfigurationView {
  return {
    organisation: {
      id: 'org-1',
      name: 'Pilot Org',
      lifecycle: 'ACTIVE',
      archivedAt: null,
      createdAt: '2026-08-26T00:00:00Z',
      updatedAt: '2026-08-26T00:00:00Z',
    },
    events: [
      {
        id: 'event-1',
        organisationId: 'org-1',
        name: 'Pilot Event',
        timezone: 'Africa/Nairobi',
        lifecycle: 'DRAFT',
        startsAt: '2026-09-01T18:00:00+03:00',
        endsAt: '2026-09-02T02:00:00+03:00',
        archivedAt: null,
        createdAt: '2026-08-26T00:00:00Z',
        updatedAt: '2026-08-26T00:00:00Z',
      },
    ],
    salesLocations: [
      {
        id: 'sales-1',
        organisationId: 'org-1',
        eventId: 'event-1',
        name: 'Main Bar',
        type: 'BAR',
        lifecycle: 'ACTIVE',
        archivedAt: null,
        createdAt: '2026-08-26T00:00:00Z',
        updatedAt: '2026-08-26T00:00:00Z',
      },
    ],
    inventoryLocations: [
      {
        id: 'stock-1',
        organisationId: 'org-1',
        eventId: 'event-1',
        name: 'Main Store',
        type: 'STORE',
        lifecycle: 'ACTIVE',
        archivedAt: null,
        createdAt: '2026-08-26T00:00:00Z',
        updatedAt: '2026-08-26T00:00:00Z',
      },
    ],
    products: [
      {
        id: 'product-1',
        organisationId: 'org-1',
        name: 'Water',
        category: 'Drinks',
        lifecycle: 'ACTIVE',
        archivedAt: null,
        createdAt: '2026-08-26T00:00:00Z',
        updatedAt: '2026-08-26T00:00:00Z',
      },
    ],
    skus: [
      {
        id: 'sku-1',
        organisationId: 'org-1',
        productId: 'product-1',
        name: 'Water 500ml',
        code: 'WATER-500',
        unitName: 'bottle',
        lifecycle: 'ACTIVE',
        archivedAt: null,
        createdAt: '2026-08-26T00:00:00Z',
        updatedAt: '2026-08-26T00:00:00Z',
      },
    ],
    menus: [
      {
        id: 'menu-1',
        organisationId: 'org-1',
        eventId: 'event-1',
        name: 'Main Menu',
        lifecycle: 'ACTIVE',
        archivedAt: null,
        createdAt: '2026-08-26T00:00:00Z',
        updatedAt: '2026-08-26T00:00:00Z',
      },
    ],
    menuAssignments: [
      {
        id: 'assignment-1',
        organisationId: 'org-1',
        menuId: 'menu-1',
        salesLocationId: 'sales-1',
        createdAt: '2026-08-26T00:00:00Z',
      },
    ],
    menuItems: [
      {
        id: 'item-1',
        organisationId: 'org-1',
        menuId: 'menu-1',
        skuId: 'sku-1',
        displayName: 'Water',
        sortOrder: 1,
        lifecycle: 'ACTIVE',
        archivedAt: null,
        createdAt: '2026-08-26T00:00:00Z',
        updatedAt: '2026-08-26T00:00:00Z',
      },
    ],
    menuItemPrices: [
      {
        id: 'price-1',
        organisationId: 'org-1',
        menuItemId: 'item-1',
        salesLocationId: null,
        amountMinor: 10000,
        currency: 'KES',
        createdAt: '2026-08-26T00:00:00Z',
        updatedAt: '2026-08-26T00:00:00Z',
      },
    ],
  };
}

describe('controlled pilot readiness', () => {
  it('marks a complete event setup ready for operational validation', () => {
    const readiness = evaluateEventReadiness(fixture(), 'event-1');
    expect(readiness.ready).toBe(true);
    expect(readiness.completed).toBe(readiness.total);
  });

  it('fails menu readiness when an assigned location has no applicable price', () => {
    const configuration = fixture();
    configuration.menuItemPrices = [];

    const readiness = evaluateEventReadiness(configuration, 'event-1');
    expect(readiness.ready).toBe(false);
    expect(readiness.items.find((item) => item.key === 'menus')?.complete).toBe(false);
  });

  it('does not treat a closed event as ready', () => {
    const configuration = fixture();
    configuration.events[0]!.lifecycle = 'CLOSED';

    const readiness = evaluateEventReadiness(configuration, 'event-1');
    expect(readiness.ready).toBe(false);
    expect(readiness.items.find((item) => item.key === 'event')?.complete).toBe(false);
  });
});
