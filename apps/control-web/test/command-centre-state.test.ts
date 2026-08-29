import { describe, expect, it } from 'vitest';
import type { CommandCentreSnapshot } from '@event-commerce/contracts';
import {
  deviceReportingState,
  nextRealtimeMode,
  snapshotIsStale,
  venueTelemetry,
} from '../src/app/command-centre/command-centre-state';

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

describe('command centre venue telemetry', () => {
  const device = (
    deviceId: string,
    status: 'HEALTHY' | 'DEGRADED' | 'STALE',
    edgeBacklogCount = 0,
  ): CommandCentreSnapshot['devices'][number] => ({
    deviceId,
    salesLocationId: 'location-1',
    salesLocationName: 'Main Bar',
    lastSeenAt: '2026-08-28T18:00:00.000Z',
    lastCloudDeliveryAt: '2026-08-28T18:00:00.000Z',
    edgeBacklogCount,
    syncAgeSeconds: status === 'STALE' ? 600 : status === 'DEGRADED' ? 60 : 5,
    status,
  });

  it('does not claim local selling when no register telemetry exists', () => {
    expect(venueTelemetry([])).toEqual({
      tone: 'neutral',
      label: 'No register telemetry yet',
      reportingCount: 0,
      totalCount: 0,
    });
  });

  it('uses current register reporting as the venue signal', () => {
    expect(venueTelemetry([device('till-1', 'HEALTHY'), device('till-2', 'HEALTHY')])).toEqual({
      tone: 'success',
      label: 'All 2 registers reporting',
      reportingCount: 2,
      totalCount: 2,
    });
  });

  it('warns without inferring that local checkout has stopped', () => {
    expect(venueTelemetry([device('till-1', 'STALE'), device('till-2', 'STALE')])).toEqual({
      tone: 'warning',
      label: 'Local status not confirmed',
      reportingCount: 0,
      totalCount: 2,
    });

    expect(venueTelemetry([device('till-1', 'HEALTHY'), device('till-2', 'STALE')])).toEqual({
      tone: 'warning',
      label: '1/2 registers reporting',
      reportingCount: 1,
      totalCount: 2,
    });
  });

  it('marks queued or delayed telemetry as warning while registers are still reporting', () => {
    expect(venueTelemetry([device('till-1', 'DEGRADED', 3)])).toEqual({
      tone: 'warning',
      label: '1 register reporting',
      reportingCount: 1,
      totalCount: 1,
    });
  });

  it('distinguishes a provisioned till that has never reported from a stale till', () => {
    const neverReported = device('till-new', 'STALE');
    neverReported.lastSeenAt = null;
    neverReported.lastCloudDeliveryAt = null;
    neverReported.syncAgeSeconds = null;

    expect(deviceReportingState(neverReported)).toBe('NEVER_REPORTED');
    expect(deviceReportingState(device('till-stale', 'STALE'))).toBe('STALE');
    expect(deviceReportingState(device('till-late', 'DEGRADED'))).toBe('DEGRADED');
  });
});
