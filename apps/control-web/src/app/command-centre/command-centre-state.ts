import type { CommandCentreSnapshot } from '@event-commerce/contracts';

export type CommandCentreRealtimeMode = 'IDLE' | 'CONNECTING' | 'LIVE' | 'POLLING';
export type CommandCentreRealtimeEvent =
  | 'RESET'
  | 'CONNECT'
  | 'STREAM_CONNECTED'
  | 'STREAM_FAILED';

export const COMMAND_CENTRE_POLL_INTERVAL_MS = 15_000;

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
