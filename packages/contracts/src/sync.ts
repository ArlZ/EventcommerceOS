export const SYNC_SCHEMA_VERSION = 1 as const;

export interface SyncEventEnvelope {
  schemaVersion: 1;
  eventInstanceId: string;
  eventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  eventVersion: number;
  deviceId: string;
  sequence: number;
  occurredAt: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}

export interface DeviceSyncBatch {
  deviceId: string;
  events: SyncEventEnvelope[];
}

export interface SyncEventReceipt {
  eventInstanceId: string;
  status: 'ACCEPTED' | 'DUPLICATE' | 'CONFLICT';
  reason?: string;
}

export interface DeviceSyncAck {
  deviceId: string;
  acceptedThroughSequence: number;
  receipts: SyncEventReceipt[];
  edgeBacklogCount: number;
  serverTime: string;
}

export interface DeviceCloudStatus {
  deviceId: string;
  lastSeenAt: string | null;
  lastSequenceSeen: number;
  edgeAcceptedThroughSequence: number;
  edgeBacklogCount: number;
  lastCloudDeliveryAt: string | null;
  syncAgeSeconds?: number | null;
  operationalStatus?: 'HEALTHY' | 'DEGRADED' | 'STALE';
}

export interface PosDeviceCloudRosterEntry {
  deviceId: string;
  eventId: string;
  salesLocationId: string | null;
  registerId: string | null;
  status: 'ACTIVE' | 'REVOKED';
  updatedAt: string;
}

export interface EdgeCloudBatch {
  edgeId: string;
  events: SyncEventEnvelope[];
  deviceStatuses: DeviceCloudStatus[];
  posDevices?: PosDeviceCloudRosterEntry[];
}

export interface EdgeCloudAck {
  acceptedEventInstanceIds: string[];
  duplicateEventInstanceIds: string[];
  conflictEventInstanceIds: string[];
  serverTime: string;
}
