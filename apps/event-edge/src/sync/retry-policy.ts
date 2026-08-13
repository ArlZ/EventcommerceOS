export function retryDelayMs(
  attempt: number,
  random: () => number = Math.random,
  baseMs = 500,
  maxMs = 30_000,
): number {
  const safeAttempt = Math.max(1, Math.min(attempt, 16));
  const exponential = Math.min(maxMs, baseMs * 2 ** (safeAttempt - 1));
  const jitter = 0.8 + Math.max(0, Math.min(random(), 1)) * 0.4;
  return Math.max(baseMs, Math.min(maxMs, Math.round(exponential * jitter)));
}
