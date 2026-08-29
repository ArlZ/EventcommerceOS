import { BadRequestException } from '@nestjs/common';
import {
  SYNC_SCHEMA_VERSION,
  type DeviceCloudStatus,
  type EdgeCloudBatch,
  type PosDeviceCloudRosterEntry,
  type SyncEventEnvelope,
} from '@event-commerce/contracts';

function stringField(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || value.length === 0)
    throw new BadRequestException(`${key} is required`);
  return value;
}

function integerField(body: Record<string, unknown>, key: string, minimum = 0): number {
  const value = body[key];
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new BadRequestException(`${key} must be a safe integer >= ${minimum}`);
  }
  return value as number;
}

function envelope(value: unknown): SyncEventEnvelope {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException('event must be an object');
  const body = value as Record<string, unknown>;
  if (body.schemaVersion !== SYNC_SCHEMA_VERSION)
    throw new BadRequestException('unsupported schemaVersion');
  const payload = body.payload;
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload))
    throw new BadRequestException('payload must be an object');
  const occurredAt = stringField(body, 'occurredAt');
  if (Number.isNaN(Date.parse(occurredAt)))
    throw new BadRequestException('occurredAt must be an ISO timestamp');
  return {
    schemaVersion: SYNC_SCHEMA_VERSION,
    eventInstanceId: stringField(body, 'eventInstanceId'),
    eventId: stringField(body, 'eventId'),
    eventType: stringField(body, 'eventType'),
    aggregateType: stringField(body, 'aggregateType'),
    aggregateId: stringField(body, 'aggregateId'),
    eventVersion: integerField(body, 'eventVersion', 1),
    deviceId: stringField(body, 'deviceId'),
    sequence: integerField(body, 'sequence', 1),
    occurredAt,
    idempotencyKey: stringField(body, 'idempotencyKey'),
    payload: payload as Record<string, unknown>,
  };
}

function status(value: unknown): DeviceCloudStatus {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException('device status must be an object');
  const body = value as Record<string, unknown>;
  const lastSeenAt = stringField(body, 'lastSeenAt');
  if (Number.isNaN(Date.parse(lastSeenAt)))
    throw new BadRequestException('lastSeenAt must be an ISO timestamp');
  const lastCloud = body.lastCloudDeliveryAt;
  if (
    lastCloud !== null &&
    (typeof lastCloud !== 'string' || Number.isNaN(Date.parse(lastCloud)))
  ) {
    throw new BadRequestException('lastCloudDeliveryAt must be null or an ISO timestamp');
  }
  return {
    deviceId: stringField(body, 'deviceId'),
    lastSeenAt,
    lastSequenceSeen: integerField(body, 'lastSequenceSeen'),
    edgeAcceptedThroughSequence: integerField(body, 'edgeAcceptedThroughSequence'),
    edgeBacklogCount: integerField(body, 'edgeBacklogCount'),
    lastCloudDeliveryAt: lastCloud as string | null,
  };
}

function nullableStringField(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  if (value === null) return null;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(`${key} must be null or a non-empty string`);
  }
  return value.trim();
}

function posDevice(value: unknown): PosDeviceCloudRosterEntry {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('POS device roster entry must be an object');
  }
  const body = value as Record<string, unknown>;
  const rosterStatus = body.status;
  if (rosterStatus !== 'ACTIVE' && rosterStatus !== 'REVOKED') {
    throw new BadRequestException('POS device roster status must be ACTIVE or REVOKED');
  }
  const updatedAt = stringField(body, 'updatedAt');
  if (Number.isNaN(Date.parse(updatedAt))) {
    throw new BadRequestException('POS device roster updatedAt must be an ISO timestamp');
  }
  return {
    deviceId: stringField(body, 'deviceId').trim(),
    eventId: stringField(body, 'eventId').trim(),
    salesLocationId: nullableStringField(body, 'salesLocationId'),
    registerId: nullableStringField(body, 'registerId'),
    status: rosterStatus,
    updatedAt,
  };
}

export function parseEdgeBatch(value: unknown): EdgeCloudBatch {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException('edge batch must be an object');
  const body = value as Record<string, unknown>;
  if (!Array.isArray(body.events) || body.events.length > 100) {
    throw new BadRequestException('events must contain between 0 and 100 events');
  }
  if (!Array.isArray(body.deviceStatuses))
    throw new BadRequestException('deviceStatuses must be an array');

  const rawPosDevices = body.posDevices;
  if (rawPosDevices !== undefined && !Array.isArray(rawPosDevices)) {
    throw new BadRequestException('posDevices must be an array when provided');
  }
  const posDevices = (rawPosDevices ?? []).map(posDevice);
  if (posDevices.length > 5_000) {
    throw new BadRequestException('posDevices must contain at most 5000 entries');
  }
  if (new Set(posDevices.map((device) => device.deviceId)).size !== posDevices.length) {
    throw new BadRequestException('posDevices must not contain duplicate deviceId values');
  }
  if (body.events.length === 0 && posDevices.length === 0) {
    throw new BadRequestException('sync batch must contain events or POS device roster entries');
  }

  return {
    edgeId: stringField(body, 'edgeId'),
    events: body.events.map(envelope),
    deviceStatuses: body.deviceStatuses.map(status),
    posDevices,
  };
}
