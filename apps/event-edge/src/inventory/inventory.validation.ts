import { BadRequestException } from '@nestjs/common';
import { ALERT_STATES, INVENTORY_MOVEMENT_TYPES } from '@event-commerce/domain';
import type {
  AlertTransitionInput,
  CloseStockCountInput,
  CreateStockCountInput,
  CreateTransferInput,
  InventoryConfigurationSnapshot,
  ManualMovementInput,
  TransferDispatchInput,
  TransferReceiptInput,
  TransferTransitionInput,
} from './inventory.types';

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

function optionalText(value: unknown, label: string): string | undefined {
  return value === undefined || value === null ? undefined : text(value, label);
}

function number(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new BadRequestException(`${label} must be a finite number`);
  }
  return value;
}

function optionalNumber(value: unknown, label: string): number | undefined {
  return value === undefined || value === null ? undefined : number(value, label);
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = number(value, label);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new BadRequestException(`${label} must be a positive integer`);
  }
  return parsed;
}

function optionalPositiveInteger(value: unknown, label: string): number | undefined {
  return value === undefined || value === null ? undefined : positiveInteger(value, label);
}

function integerString(value: unknown, label: string, allowZero = true): string {
  const parsed = text(value, label);
  if (!/^-?\d+$/.test(parsed)) throw new BadRequestException(`${label} must be an integer string`);
  const quantity = BigInt(parsed);
  if (!allowZero && quantity === 0n) throw new BadRequestException(`${label} must not be zero`);
  return quantity.toString();
}

function nonNegativeIntegerString(value: unknown, label: string): string {
  const parsed = BigInt(integerString(value, label));
  if (parsed < 0n) throw new BadRequestException(`${label} must not be negative`);
  return parsed.toString();
}

function positiveIntegerString(value: unknown, label: string): string {
  const parsed = BigInt(integerString(value, label, false));
  if (parsed < 0n) throw new BadRequestException(`${label} must be positive`);
  return parsed.toString();
}

function timestamp(value: unknown, label: string): string {
  const parsed = text(value, label);
  if (Number.isNaN(Date.parse(parsed))) throw new BadRequestException(`${label} must be an RFC3339 timestamp`);
  return new Date(parsed).toISOString();
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new BadRequestException(`${label} must be an array`);
  return value;
}

export function parseInventoryConfiguration(value: unknown): InventoryConfigurationSnapshot {
  const input = object(value, 'inventory configuration');
  const eventId = text(input.eventId, 'eventId');
  return {
    eventId,
    eventEndAt: timestamp(input.eventEndAt, 'eventEndAt'),
    shortWindowMinutes: optionalPositiveInteger(input.shortWindowMinutes, 'shortWindowMinutes'),
    mediumWindowMinutes: optionalPositiveInteger(input.mediumWindowMinutes, 'mediumWindowMinutes'),
    shortWeightBasisPoints: optionalNumber(input.shortWeightBasisPoints, 'shortWeightBasisPoints'),
    escalationMinutes: optionalPositiveInteger(input.escalationMinutes, 'escalationMinutes'),
    sourceActorId: text(input.sourceActorId, 'sourceActorId'),
    locations: array(input.locations, 'locations').map((item, index) => {
      const row = object(item, `locations[${index}]`);
      return { id: text(row.id, 'location.id'), name: text(row.name, 'location.name'), type: text(row.type, 'location.type') };
    }),
    skus: array(input.skus, 'skus').map((item, index) => {
      const row = object(item, `skus[${index}]`);
      return {
        skuId: text(row.skuId, 'sku.skuId'),
        name: text(row.name, 'sku.name'),
        category: optionalText(row.category, 'sku.category'),
        baseUnit: text(row.baseUnit, 'sku.baseUnit'),
      };
    }),
    salesMappings: array(input.salesMappings, 'salesMappings').map((item, index) => {
      const row = object(item, `salesMappings[${index}]`);
      return {
        salesLocationId: text(row.salesLocationId, 'mapping.salesLocationId'),
        inventoryLocationId: text(row.inventoryLocationId, 'mapping.inventoryLocationId'),
      };
    }),
    recipes: array(input.recipes, 'recipes').map((item, index) => {
      const row = object(item, `recipes[${index}]`);
      return {
        soldSkuId: text(row.soldSkuId, 'recipe.soldSkuId'),
        componentSkuId: text(row.componentSkuId, 'recipe.componentSkuId'),
        quantityPerSoldUnit: positiveIntegerString(row.quantityPerSoldUnit, 'recipe.quantityPerSoldUnit'),
      };
    }),
    alertConfigs: array(input.alertConfigs, 'alertConfigs').map((item, index) => {
      const row = object(item, `alertConfigs[${index}]`);
      return {
        id: text(row.id, 'alertConfig.id'),
        inventoryLocationId: optionalText(row.inventoryLocationId, 'alertConfig.inventoryLocationId'),
        skuId: text(row.skuId, 'alertConfig.skuId'),
        absoluteMinimum: nonNegativeIntegerString(row.absoluteMinimum, 'alertConfig.absoluteMinimum'),
        minutesCoverThreshold: number(row.minutesCoverThreshold, 'alertConfig.minutesCoverThreshold'),
        targetCoverMinutes: number(row.targetCoverMinutes, 'alertConfig.targetCoverMinutes'),
        sourceSafetyStock: nonNegativeIntegerString(row.sourceSafetyStock, 'alertConfig.sourceSafetyStock'),
        eventWideSafetyStock: nonNegativeIntegerString(row.eventWideSafetyStock, 'alertConfig.eventWideSafetyStock'),
        imbalanceRatio: optionalNumber(row.imbalanceRatio, 'alertConfig.imbalanceRatio'),
      };
    }),
    responsibilities: array(input.responsibilities, 'responsibilities').map((item, index) => {
      const row = object(item, `responsibilities[${index}]`);
      return {
        id: text(row.id, 'responsibility.id'),
        inventoryLocationId: optionalText(row.inventoryLocationId, 'responsibility.inventoryLocationId'),
        category: optionalText(row.category, 'responsibility.category'),
        responsibleActorId: text(row.responsibleActorId, 'responsibility.responsibleActorId'),
        escalationActorId: optionalText(row.escalationActorId, 'responsibility.escalationActorId'),
        priority: row.priority === undefined ? undefined : positiveInteger(row.priority, 'responsibility.priority'),
      };
    }),
    permissions: array(input.permissions, 'permissions').map((item, index) => {
      const row = object(item, `permissions[${index}]`);
      const permission = text(row.permission, 'permission.permission');
      const allowed = ['INVENTORY_MOVE', 'TRANSFER_MANAGE', 'COUNT_MANAGE', 'ALERT_MANAGE', 'INVENTORY_CONFIGURE'] as const;
      if (!allowed.includes(permission as (typeof allowed)[number])) {
        throw new BadRequestException(`permissions[${index}].permission is invalid`);
      }
      return { actorId: text(row.actorId, 'permission.actorId'), permission: permission as (typeof allowed)[number] };
    }),
  };
}

export function parseManualMovement(value: unknown): ManualMovementInput {
  const input = object(value, 'movement');
  const movementType = text(input.movementType, 'movementType');
  if (!INVENTORY_MOVEMENT_TYPES.includes(movementType as (typeof INVENTORY_MOVEMENT_TYPES)[number])) {
    throw new BadRequestException('movementType is invalid');
  }
  return {
    id: text(input.id, 'id'),
    eventId: text(input.eventId, 'eventId'),
    inventoryLocationId: text(input.inventoryLocationId, 'inventoryLocationId'),
    skuId: text(input.skuId, 'skuId'),
    movementType: movementType as ManualMovementInput['movementType'],
    quantityDeltaBase: integerString(input.quantityDeltaBase, 'quantityDeltaBase', false),
    actorId: text(input.actorId, 'actorId'),
    reason: text(input.reason, 'reason'),
    occurredAt: timestamp(input.occurredAt, 'occurredAt'),
    idempotencyKey: text(input.idempotencyKey, 'idempotencyKey'),
    reversalOfLedgerId: optionalText(input.reversalOfLedgerId, 'reversalOfLedgerId'),
  };
}

export function parseCreateTransfer(value: unknown): CreateTransferInput {
  const input = object(value, 'transfer');
  const lines = array(input.lines, 'lines').map((item, index) => {
    const row = object(item, `lines[${index}]`);
    return { skuId: text(row.skuId, 'line.skuId'), requestedQuantityBase: positiveIntegerString(row.requestedQuantityBase, 'line.requestedQuantityBase') };
  });
  if (lines.length === 0) throw new BadRequestException('transfer lines must not be empty');
  return {
    id: text(input.id, 'id'), eventId: text(input.eventId, 'eventId'),
    sourceLocationId: text(input.sourceLocationId, 'sourceLocationId'), destinationLocationId: text(input.destinationLocationId, 'destinationLocationId'),
    actorId: text(input.actorId, 'actorId'), reason: text(input.reason, 'reason'), requestedAt: timestamp(input.requestedAt, 'requestedAt'),
    idempotencyKey: text(input.idempotencyKey, 'idempotencyKey'), lines,
  };
}

export function parseTransferTransition(value: unknown): TransferTransitionInput {
  const input = object(value, 'transfer transition');
  return { actorId: text(input.actorId, 'actorId'), reason: optionalText(input.reason, 'reason'), assignedActorId: optionalText(input.assignedActorId, 'assignedActorId'), occurredAt: timestamp(input.occurredAt, 'occurredAt') };
}

export function parseTransferDispatch(value: unknown): TransferDispatchInput {
  const input = object(value, 'transfer dispatch');
  const base = parseTransferTransition(value);
  const quantities = array(input.quantities, 'quantities').map((item, index) => {
    const row = object(item, `quantities[${index}]`);
    return { skuId: text(row.skuId, 'quantity.skuId'), quantityBase: positiveIntegerString(row.quantityBase, 'quantity.quantityBase') };
  });
  if (quantities.length === 0) throw new BadRequestException('dispatch quantities must not be empty');
  return { ...base, quantities };
}

export function parseTransferReceipt(value: unknown): TransferReceiptInput {
  const input = object(value, 'transfer receipt');
  const quantities = array(input.quantities, 'quantities').map((item, index) => {
    const row = object(item, `quantities[${index}]`);
    return { skuId: text(row.skuId, 'quantity.skuId'), quantityBase: positiveIntegerString(row.quantityBase, 'quantity.quantityBase') };
  });
  if (quantities.length === 0) throw new BadRequestException('receipt quantities must not be empty');
  return {
    actorId: text(input.actorId, 'actorId'), reason: optionalText(input.reason, 'reason'), receivedAt: timestamp(input.receivedAt, 'receivedAt'),
    idempotencyKey: text(input.idempotencyKey, 'idempotencyKey'), quantities,
  };
}

export function parseCreateStockCount(value: unknown): CreateStockCountInput {
  const input = object(value, 'stock count');
  const lines = array(input.lines, 'lines').map((item, index) => {
    const row = object(item, `lines[${index}]`);
    return { skuId: text(row.skuId, 'line.skuId'), countedQuantityBase: nonNegativeIntegerString(row.countedQuantityBase, 'line.countedQuantityBase') };
  });
  if (lines.length === 0) throw new BadRequestException('count lines must not be empty');
  return { id: text(input.id, 'id'), eventId: text(input.eventId, 'eventId'), inventoryLocationId: text(input.inventoryLocationId, 'inventoryLocationId'), actorId: text(input.actorId, 'actorId'), reason: text(input.reason, 'reason'), openedAt: timestamp(input.openedAt, 'openedAt'), lines };
}

export function parseCloseStockCount(value: unknown): CloseStockCountInput {
  const input = object(value, 'stock count close');
  return { actorId: text(input.actorId, 'actorId'), reason: text(input.reason, 'reason'), closedAt: timestamp(input.closedAt, 'closedAt') };
}

export function parseAlertTransition(value: unknown): AlertTransitionInput {
  const input = object(value, 'alert transition');
  const toState = text(input.toState, 'toState');
  if (!ALERT_STATES.includes(toState as (typeof ALERT_STATES)[number])) throw new BadRequestException('toState is invalid');
  return { actorId: text(input.actorId, 'actorId'), toState: toState as AlertTransitionInput['toState'], assignedActorId: optionalText(input.assignedActorId, 'assignedActorId'), reason: optionalText(input.reason, 'reason'), occurredAt: timestamp(input.occurredAt, 'occurredAt') };
}
