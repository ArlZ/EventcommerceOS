export interface HealthResponse {
  service: string;
  status: 'ok';
  version: string;
  releaseCommit: string | null;
  timestamp: string;
}

export function makeHealthResponse(
  service: string,
  now: Date = new Date(),
  releaseCommit: string | null | undefined = null,
): HealthResponse {
  const normalizedReleaseCommit = releaseCommit?.trim() || null;
  return {
    service,
    status: 'ok',
    version: '0.1.0',
    releaseCommit: normalizedReleaseCommit,
    timestamp: now.toISOString(),
  };
}

export * from './command-centre';
export * from './configuration';
export * from './event-close';
export * from './inventory';
export * from './payment';
export * from './sync';
