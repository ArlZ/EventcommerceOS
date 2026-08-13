import { BadRequestException } from '@nestjs/common';
import {
  SYNC_SCHEMA_VERSION,
  type DeviceSyncBatch,
  type SyncEventEnvelope,
} from '@event-commerce/contracts';

function requiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || value.length === 0) throw new BadRequestException(`${key} is required`);
  return value;
}

function positiveInteger(body: Record<string, unknown>, key: string): number {
  const value = body[key];
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new BadRequestException(`${key} must be a positive safe integer`);
  }
  return value as number;
}

export function parseEnvelope(value: unknown): SyncEventEnvelope {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('event must be an object');
  }
  const body = value as Record<string, unknown>;
  if (body.schemaVersion !== SYNC_SCHEMA_VERSION) throw new BadRequestException('unsupported schemaVersion');
  const occurredAt = requiredString(body, 'occurredAt');
  if (Number.isNaN(Date.parse(occurredAt))) throw new BadRequestException('occurredAt must be an ISO timestamp');
  const payload = body.payload;
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new BadRequestException('payload must be an object');
  }
  return {
    schemaVersion: SYNC_SCHEMA_VERSION,
    eventInstanceId: requiredString(body, 'eventInstanceId'),
    eventId: requiredString(body, 'eventId'),
    eventType: requiredString(body, 'eventType'),
    aggregateType: requiredString(body, 'aggregateType'),
    aggregateId: requiredString(body, 'aggregateId'),
    eventVersion: positiveInteger(body, 'eventVersion'),
    deviceId: requiredString(body, 'deviceId'),
    sequence: positiveInteger(body, 'sequence'),
    occurredAt,
    idempotencyKey: requiredString(body, 'idempotencyKey'),
    payload: payload as Record<string, unknown>,
  };
}

export function parseDeviceBatch(value: unknown): DeviceSyncBatch {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('sync batch must be an object');
  }
  const body = value as Record<string, unknown>;
  const deviceId = requiredString(body, 'deviceId');
  if (!Array.isArray(body.events) || body.events.length === 0 || body.events.length > 100) {
    throw new BadRequestException('events must contain between 1 and 100 events');
  }
  const events = body.events.map(parseEnvelope);
  if (events.some((event) => event.deviceId !== deviceId)) {
    throw new BadRequestException('every event deviceId must match the batch deviceId');
  }
  return { deviceId, events };
}
