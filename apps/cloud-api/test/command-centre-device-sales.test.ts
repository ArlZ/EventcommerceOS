import { describe, expect, it } from 'vitest';
import type { CommandCentreSnapshot } from '@event-commerce/contracts';
import type { DatabaseService } from '../src/database/database.service';
import { CommandCentreDeviceSalesService } from '../src/command-centre/command-centre-device-sales.service';

function snapshot(): CommandCentreSnapshot {
  return {
    event: {
      eventId: 'event-1',
      organisationId: 'org-1',
      name: 'Event',
      timezone: 'Africa/Nairobi',
      lifecycle: 'ACTIVE',
      startsAt: '2026-08-14T12:00:00.000Z',
      endsAt: '2026-08-14T22:00:00.000Z',
    },
    freshness: {
      generatedAt: '2026-08-14T14:00:00.000Z',
      staleAfterSeconds: 30,
      latestSourceAt: null,
    },
    sales: {
      transactionCount: 0,
      grossSales: [],
      averageOrderValue: [],
      currentSalesVelocity: [],
      lastSaleAt: null,
    },
    salesPulse: [],
    salesLocations: [],
    topProducts: [],
    payments: {
      settledMethods: [],
      attempts: {
        totalCount: 0,
        succeededCount: 0,
        pendingCount: 0,
        unknownCount: 0,
        failedCount: 0,
        successRate: 0,
        pendingRate: 0,
        unknownRate: 0,
        failureRate: 0,
        unknownValue: [],
      },
      rails: [],
    },
    inventory: { risks: [], activeTransfers: [] },
    devices: [
      {
        deviceId: 'device-1',
        salesLocationId: 'location-1',
        salesLocationName: 'Main Bar',
        lastSeenAt: '2026-08-14T13:59:55.000Z',
        lastCloudDeliveryAt: null,
        edgeBacklogCount: 0,
        syncAgeSeconds: 5,
        status: 'HEALTHY',
      },
    ],
    alerts: [],
  };
}

describe('command centre device sales', () => {
  it('adds all device sales buckets with one event-scoped query', async () => {
    let queries = 0;
    const database = {
      async query<T>(): Promise<T[]> {
        queries += 1;
        return [
          {
            device_id: 'device-1',
            currency: 'KES',
            transaction_count: '3',
            gross_minor: '45000',
            velocity_minor_per_minute: '3000',
          },
        ] as T[];
      },
    } as unknown as DatabaseService;
    const service = new CommandCentreDeviceSalesService(database);

    const enriched = await service.enrich('event-1', snapshot());

    expect(queries).toBe(1);
    expect(enriched.devices[0]).toMatchObject({
      transactionCount: 3,
      grossSales: [{ currency: 'KES', amountMinor: '45000' }],
      currentSalesVelocity: [{ currency: 'KES', amountMinorPerMinute: '3000' }],
    });
  });
});
