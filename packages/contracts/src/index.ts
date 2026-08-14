export interface HealthResponse {
  service: string;
  status: 'ok';
  version: string;
  timestamp: string;
}

export function makeHealthResponse(service: string, now: Date = new Date()): HealthResponse {
  return { service, status: 'ok', version: '0.1.0', timestamp: now.toISOString() };
}

export * from './command-centre';
export * from './configuration';
export * from './event-close';
export * from './inventory';
export * from './payment';
export * from './sync';
