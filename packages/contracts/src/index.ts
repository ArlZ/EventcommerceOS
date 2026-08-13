export interface HealthResponse {
  service: string;
  status: 'ok';
  version: string;
  timestamp: string;
}

export function makeHealthResponse(service: string, now: Date = new Date()): HealthResponse {
  return { service, status: 'ok', version: '0.1.0', timestamp: now.toISOString() };
}

export * from './configuration';
export * from './sync';
