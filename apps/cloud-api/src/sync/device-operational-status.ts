export type DeviceOperationalStatus = 'HEALTHY' | 'DEGRADED' | 'STALE';

export const DEVICE_DEGRADED_AFTER_SECONDS = 30;
export const DEVICE_STALE_AFTER_SECONDS = 120;

export function deviceSyncAgeSeconds(
  lastSeenAt: Date | string | null,
  now = new Date(),
): number | null {
  if (lastSeenAt === null) return null;
  const seen = lastSeenAt instanceof Date ? lastSeenAt : new Date(lastSeenAt);
  if (Number.isNaN(seen.getTime())) throw new Error('lastSeenAt is not a valid timestamp');
  return Math.max(0, Math.floor((now.getTime() - seen.getTime()) / 1000));
}

export function deviceOperationalStatus(input: {
  syncAgeSeconds: number | null;
  edgeBacklogCount: number;
}): DeviceOperationalStatus {
  if (input.syncAgeSeconds === null || input.syncAgeSeconds > DEVICE_STALE_AFTER_SECONDS) {
    return 'STALE';
  }
  if (
    input.edgeBacklogCount > 0 ||
    input.syncAgeSeconds > DEVICE_DEGRADED_AFTER_SECONDS
  ) {
    return 'DEGRADED';
  }
  return 'HEALTHY';
}
