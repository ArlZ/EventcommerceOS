import { BadRequestException } from '@nestjs/common';
import type { PosMenuItemSnapshot, PosMenuSnapshot } from './pos-menu.types';

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

function safeInteger(value: unknown, label: string, minimum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new BadRequestException(`${label} must be a safe integer >= ${minimum}`);
  }
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new BadRequestException(`${label} must be a boolean`);
  return value;
}

function appendField(parts: string[], value: string): void {
  parts.push(`${value.length}:${value}|`);
}

function crc32(value: string): string {
  let crc = 0xffffffff;
  for (const byte of Buffer.from(value, 'utf8')) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}

export function posMenuChecksum(
  snapshot: Omit<PosMenuSnapshot, 'checksum' | 'salesLocationId'>,
): string {
  const parts: string[] = [];
  appendField(parts, snapshot.eventId);
  appendField(parts, snapshot.menuId);
  appendField(parts, snapshot.version.toString());
  appendField(parts, snapshot.activatedAtEpochMs.toString());
  appendField(parts, snapshot.sourceActor);
  appendField(parts, snapshot.currency);
  [...snapshot.items]
    .sort((left, right) =>
      left.itemId < right.itemId ? -1 : left.itemId > right.itemId ? 1 : 0,
    )
    .forEach((item) => {
      appendField(parts, item.itemId);
      appendField(parts, item.skuId);
      appendField(parts, item.name);
      appendField(parts, item.category);
      appendField(parts, item.priceMinor.toString());
      appendField(parts, item.favourite ? '1' : '0');
      appendField(parts, item.sortOrder.toString());
    });
  return crc32(parts.join(''));
}

function parseItem(value: unknown, index: number): PosMenuItemSnapshot {
  const row = object(value, `items[${index}]`);
  return {
    itemId: text(row.itemId, `items[${index}].itemId`),
    skuId: text(row.skuId, `items[${index}].skuId`),
    name: text(row.name, `items[${index}].name`),
    category: text(row.category, `items[${index}].category`),
    priceMinor: safeInteger(row.priceMinor, `items[${index}].priceMinor`, 0),
    favourite:
      row.favourite === undefined ? false : boolean(row.favourite, `items[${index}].favourite`),
    sortOrder:
      row.sortOrder === undefined
        ? 0
        : safeInteger(row.sortOrder, `items[${index}].sortOrder`, 0),
  };
}

export function parsePosMenuSnapshot(value: unknown): PosMenuSnapshot {
  const row = object(value, 'menu snapshot');
  const currency = text(row.currency, 'currency').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new BadRequestException('currency must be a three-letter uppercase code');
  }
  if (!Array.isArray(row.items) || row.items.length === 0) {
    throw new BadRequestException('items must contain at least one menu item');
  }

  const items = row.items.map(parseItem);
  const itemIds = new Set<string>();
  const skuIds = new Set<string>();
  for (const item of items) {
    if (itemIds.has(item.itemId)) {
      throw new BadRequestException(`duplicate menu item id: ${item.itemId}`);
    }
    if (skuIds.has(item.skuId)) {
      throw new BadRequestException(`duplicate menu item sku id: ${item.skuId}`);
    }
    itemIds.add(item.itemId);
    skuIds.add(item.skuId);
  }

  const snapshot: PosMenuSnapshot = {
    eventId: text(row.eventId, 'eventId'),
    salesLocationId: text(row.salesLocationId, 'salesLocationId'),
    menuId: text(row.menuId, 'menuId'),
    version: safeInteger(row.version, 'version', 1),
    activatedAtEpochMs: safeInteger(row.activatedAtEpochMs, 'activatedAtEpochMs', 1),
    sourceActor: text(row.sourceActor, 'sourceActor'),
    currency,
    checksum: text(row.checksum, 'checksum').toLowerCase(),
    items,
  };
  if (!/^[0-9a-f]{8}$/.test(snapshot.checksum)) {
    throw new BadRequestException('checksum must be eight lowercase hex characters');
  }
  const expected = posMenuChecksum(snapshot);
  if (snapshot.checksum !== expected) {
    throw new BadRequestException('menu checksum does not match content');
  }
  return snapshot;
}
