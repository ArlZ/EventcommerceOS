import type { CommandCentreSnapshot } from '@event-commerce/contracts';

export type CommandCentreRealtimeMode = 'IDLE' | 'CONNECTING' | 'LIVE' | 'POLLING';
export type CommandCentreRealtimeEvent = 'RESET' | 'CONNECT' | 'STREAM_CONNECTED' | 'STREAM_FAILED';

export const COMMAND_CENTRE_POLL_INTERVAL_MS = 15_000;

export interface CommandCentreVenueTelemetry {
  tone: 'success' | 'warning' | 'neutral';
  label: string;
  reportingCount: number;
  totalCount: number;
}

export function venueTelemetry(
  devices: CommandCentreSnapshot['devices'],
): CommandCentreVenueTelemetry {
  const totalCount = devices.length;
  const reportingCount = devices.filter((device) => device.status !== 'STALE').length;

  if (totalCount === 0) {
    return {
      tone: 'neutral',
      label: 'No register telemetry yet',
      reportingCount,
      totalCount,
    };
  }

  if (reportingCount === 0) {
    return {
      tone: 'warning',
      label: 'Local status not confirmed',
      reportingCount,
      totalCount,
    };
  }

  const label =
    reportingCount === totalCount
      ? totalCount === 1
        ? '1 register reporting'
        : `All ${totalCount} registers reporting`
      : `${reportingCount}/${totalCount} registers reporting`;
  const degraded = devices.some(
    (device) => device.status === 'DEGRADED' || device.edgeBacklogCount > 0,
  );

  return {
    tone: reportingCount === totalCount && !degraded ? 'success' : 'warning',
    label,
    reportingCount,
    totalCount,
  };
}

export function nextRealtimeMode(
  current: CommandCentreRealtimeMode,
  event: CommandCentreRealtimeEvent,
): CommandCentreRealtimeMode {
  if (event === 'RESET') return 'IDLE';
  if (event === 'CONNECT') return 'CONNECTING';
  if (event === 'STREAM_CONNECTED') return 'LIVE';
  if (event === 'STREAM_FAILED') return current === 'IDLE' ? 'IDLE' : 'POLLING';
  return current;
}

export function snapshotIsStale(
  snapshot: CommandCentreSnapshot | null,
  nowMs: number = Date.now(),
): boolean {
  if (!snapshot) return false;
  const generatedAt = new Date(snapshot.freshness.generatedAt).getTime();
  if (!Number.isFinite(generatedAt)) return true;
  return nowMs - generatedAt > snapshot.freshness.staleAfterSeconds * 1000;
}
