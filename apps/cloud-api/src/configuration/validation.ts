import { BadRequestException } from '@nestjs/common';
import { asCurrencyCode, money } from '@event-commerce/domain';

export type JsonObject = Record<string, unknown>;

export function bodyObject(value: unknown): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('Request body must be an object');
  }
  return value as JsonObject;
}

export function requiredString(body: JsonObject, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(`${key} is required`);
  }
  return value.trim();
}

export function optionalString(body: JsonObject, key: string): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new BadRequestException(`${key} must be a string`);
  const normalized = value.trim();
  return normalized.length === 0 ? undefined : normalized;
}

export function requiredUuid(body: JsonObject, key: string): string {
  return uuid(requiredString(body, key), key);
}

export function uuid(value: string, label = 'id'): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new BadRequestException(`${label} must be a UUID`);
  }
  return value;
}

export function timezone(value: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return value;
  } catch {
    throw new BadRequestException('timezone must be a valid IANA timezone');
  }
}

export function isoTimestamp(value: string, label: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${label} must be an ISO timestamp`);
  }
  return parsed.toISOString();
}

export function eventLifecycle(value: unknown): 'DRAFT' | 'ACTIVE' | 'CLOSED' | 'ARCHIVED' {
  if (value === 'DRAFT' || value === 'ACTIVE' || value === 'CLOSED' || value === 'ARCHIVED') return value;
  throw new BadRequestException('lifecycle must be DRAFT, ACTIVE, CLOSED or ARCHIVED');
}

export function recordLifecycle(value: unknown): 'ACTIVE' | 'ARCHIVED' {
  if (value === 'ACTIVE' || value === 'ARCHIVED') return value;
  throw new BadRequestException('lifecycle must be ACTIVE or ARCHIVED');
}

export function salesLocationType(value: string): string {
  if (value !== 'BAR') throw new BadRequestException('sales location type is not supported');
  return value;
}

export function inventoryLocationType(value: string): string {
  if (value !== 'WAREHOUSE' && value !== 'BAR_STORAGE') {
    throw new BadRequestException('inventory location type is not supported');
  }
  return value;
}

export function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new BadRequestException(`${label} must be a safe integer >= ${minimum}`);
  }
  return value as number;
}

export function price(body: JsonObject): { amountMinor: number; currency: string } {
  const amountMinor = body.amountMinor;
  const currency = requiredString(body, 'currency');
  try {
    const validated = money(amountMinor as number, currency);
    return { amountMinor: validated.amountMinor, currency: asCurrencyCode(currency) };
  } catch (error) {
    throw new BadRequestException((error as Error).message);
  }
}
