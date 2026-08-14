import { BadRequestException } from '@nestjs/common';
import type {
  DeclareEventCashRequest,
  DeclareInventoryUnitCostRequest,
  EventCloseActionRequest,
  RecordCommerceOrderAdjustmentRequest,
} from '@event-commerce/contracts';
import {
  bodyObject,
  integer,
  optionalString,
  requiredString,
  requiredUuid,
} from '../configuration/validation';

function only(body: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  const unexpected = Object.keys(body).filter((key) => !allowedSet.has(key)).sort();
  if (unexpected.length > 0) {
    throw new BadRequestException(`Unexpected event close field: ${unexpected[0]}`);
  }
}

function currency(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new BadRequestException('currency must be a three-letter code');
  }
  return normalized;
}

export function parseOrderAdjustment(value: unknown): RecordCommerceOrderAdjustmentRequest {
  const body = bodyObject(value);
  only(body, [
    'adjustmentId',
    'orderId',
    'kind',
    'amountMinor',
    'currency',
    'reason',
    'idempotencyKey',
  ]);
  const kind = requiredString(body, 'kind').toUpperCase();
  if (kind !== 'DISCOUNT' && kind !== 'COMP' && kind !== 'VOID' && kind !== 'CASH_REFUND') {
    throw new BadRequestException('kind must be DISCOUNT, COMP, VOID or CASH_REFUND');
  }
  return {
    adjustmentId: requiredString(body, 'adjustmentId'),
    orderId: requiredString(body, 'orderId'),
    kind,
    amountMinor: integer(body.amountMinor, 'amountMinor', 1),
    currency: currency(requiredString(body, 'currency')),
    reason: requiredString(body, 'reason'),
    idempotencyKey: requiredString(body, 'idempotencyKey'),
  };
}

export function parseCashDeclaration(value: unknown): DeclareEventCashRequest {
  const body = bodyObject(value);
  only(body, [
    'declarationId',
    'salesLocationId',
    'deviceId',
    'cashierId',
    'currency',
    'declaredMinor',
    'reason',
    'idempotencyKey',
  ]);
  return {
    declarationId: requiredString(body, 'declarationId'),
    salesLocationId: requiredUuid(body, 'salesLocationId'),
    ...(optionalString(body, 'deviceId') ? { deviceId: optionalString(body, 'deviceId') } : {}),
    ...(optionalString(body, 'cashierId') ? { cashierId: optionalString(body, 'cashierId') } : {}),
    currency: currency(requiredString(body, 'currency')),
    declaredMinor: integer(body.declaredMinor, 'declaredMinor', 0),
    reason: requiredString(body, 'reason'),
    idempotencyKey: requiredString(body, 'idempotencyKey'),
  };
}

export function parseInventoryCostDeclaration(
  value: unknown,
): DeclareInventoryUnitCostRequest {
  const body = bodyObject(value);
  only(body, [
    'declarationId',
    'skuId',
    'currency',
    'unitCostMinor',
    'reason',
    'idempotencyKey',
  ]);
  return {
    declarationId: requiredString(body, 'declarationId'),
    skuId: requiredUuid(body, 'skuId'),
    currency: currency(requiredString(body, 'currency')),
    unitCostMinor: integer(body.unitCostMinor, 'unitCostMinor', 0),
    reason: requiredString(body, 'reason'),
    idempotencyKey: requiredString(body, 'idempotencyKey'),
  };
}

export function parseCloseAction(value: unknown): EventCloseActionRequest {
  const body = bodyObject(value);
  only(body, ['actionId', 'reason']);
  return {
    actionId: requiredString(body, 'actionId'),
    reason: requiredString(body, 'reason'),
  };
}
