import { describe, expect, it } from 'vitest';
import type { CommandCentreSnapshot } from '@event-commerce/contracts';
import { nextRealtimeMode, snapshotIsStale } from '../src/app/command-centre/command-centre-state';

function snapshot(generatedAt: string, staleAfterSeconds = 30): CommandCentreSnapshot {
  return {
    event: {
      eventId: 'event-1',
      organisationId: 'org-1',
      name: 'Event',
      timezone: 'Africa/Nairobi',
      lifecycle: 'ACTIVE',
      startsAt: generatedAt,
      endsAt: generatedAt,
    },
    freshness: { generatedAt, staleAfterSeconds, latestSourceAt: generatedAt },
    sales: {
      transactionCount: 0,
      grossSales: [],
      averageOrderValue: [],
      currentSalesVelocity: [],
      lastSaleAt: null,
    },
    salesLocations: [],
    topProducts: [],
    payments: {
      settledMethods: [],
      attempts: {
        totalCount: 0,
        pendingCount: 0,
        unknownCount: 0,
        failedCount: 0,
        pendingRate: 0,
        unknownRate: 0,
        failureRate: 0,
        unknownValue: [],
      },
      rails: [],
    },
    inventory: { risks: [], activeTransfers: [] },
    devices: [],
    alerts: [],
  };
}

describe('command centre realtime degradation', () => {
  it('falls back to polling when the realtime stream fails', () => {
    expect(nextRealtimeMode('CONNECTING', 'STREAM_CONNECTED')).toBe('LIVE');
    expect(nextRealtimeMode('LIVE', 'STREAM_FAILED')).toBe('POLLING');
    expect(nextRealtimeMode('CONNECTING', 'STREAM_FAILED')).toBe('POLLING');
  });

  it('labels a retained snapshot stale after its freshness window', () => {
    const generatedAt = '2026-08-14T13:00:00.000Z';
    const value = snapshot(generatedAt, 30);
    expect(snapshotIsStale(value, Date.parse('2026-08-14T13:00:29.000Z'))).toBe(false);
    expect(snapshotIsStale(value, Date.parse('2026-08-14T13:00:31.000Z'))).toBe(true);
  });
});
