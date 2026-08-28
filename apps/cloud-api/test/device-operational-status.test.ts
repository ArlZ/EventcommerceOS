import { describe, expect, it } from 'vitest';
import {
  DEVICE_DEGRADED_AFTER_SECONDS,
  DEVICE_STALE_AFTER_SECONDS,
  deviceOperationalStatus,
  deviceSyncAgeSeconds,
} from '../src/sync/device-operational-status';

describe('device operational status', () => {
  it('keeps a current, empty-backlog register healthy', () => {
    expect(deviceOperationalStatus({ syncAgeSeconds: 12, edgeBacklogCount: 0 })).toBe('HEALTHY');
  });

  it('marks backlog or a late heartbeat as degraded', () => {
    expect(deviceOperationalStatus({ syncAgeSeconds: 12, edgeBacklogCount: 3 })).toBe('DEGRADED');
    expect(
      deviceOperationalStatus({
        syncAgeSeconds: DEVICE_DEGRADED_AFTER_SECONDS + 1,
        edgeBacklogCount: 0,
      }),
    ).toBe('DEGRADED');
  });

  it('marks a stale or missing heartbeat as stale even with no backlog', () => {
    expect(
      deviceOperationalStatus({
        syncAgeSeconds: DEVICE_STALE_AFTER_SECONDS + 1,
        edgeBacklogCount: 0,
      }),
    ).toBe('STALE');
    expect(deviceOperationalStatus({ syncAgeSeconds: null, edgeBacklogCount: 0 })).toBe('STALE');
  });

  it('clamps future telemetry to zero age rather than producing negative age', () => {
    const now = new Date('2026-08-28T16:00:00Z');
    expect(deviceSyncAgeSeconds('2026-08-28T16:00:20Z', now)).toBe(0);
  });
});
