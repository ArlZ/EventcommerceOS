import { BadRequestException } from '@nestjs/common';
import type { InventoryEdgeBatch, InventoryEdgeEvent } from '@event-commerce/contracts';

const eventTypes = new Set<InventoryEdgeEvent['eventType']>([
  'INVENTORY_CONFIGURATION_INSTALLED',
  'INVENTORY_LEDGER_POSTED',
  'INVENTORY_TRANSFER_UPSERTED',
  'INVENTORY_COUNT_CLOSED',
  'INVENTORY_ALERT_UPSERTED',
]);
const aggregateTypes = new Set<InventoryEdgeEvent['aggregateType']>([
  'INVENTORY_EVENT',
  'STOCK_LEDGER_ENTRY',
  'STOCK_TRANSFER',
  'STOCK_COUNT',
  'INVENTORY_ALERT',
]);

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequestException(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(`${label} must be a non-empty string`);
  }
  return value.trim();
}

export function parseInventoryEdgeBatch(value: unknown): InventoryEdgeBatch {
  const input = object(value, 'inventory edge batch');
  if (!Array.isArray(input.events) || input.events.length === 0 || input.events.length > 100) {
    throw new BadRequestException('events must contain between 1 and 100 inventory events');
  }
  const events = input.events.map((raw, index): InventoryEdgeEvent => {
    const row = object(raw, `events[${index}]`);
    const eventType = text(row.eventType, 'eventType') as InventoryEdgeEvent['eventType'];
    const aggregateType = text(row.aggregateType, 'aggregateType') as InventoryEdgeEvent['aggregateType'];
    if (!eventTypes.has(eventType)) throw new BadRequestException(`events[${index}].eventType is invalid`);
    if (!aggregateTypes.has(aggregateType)) throw new BadRequestException(`events[${index}].aggregateType is invalid`);
    return {
      id: text(row.id, 'event.id'),
      eventType,
      aggregateType,
      aggregateId: text(row.aggregateId, 'event.aggregateId'),
      payload: object(row.payload, 'event.payload'),
    };
  });
  return { edgeId: text(input.edgeId, 'edgeId'), events };
}
