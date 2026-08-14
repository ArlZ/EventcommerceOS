import type { InventoryAlertState, InventoryMovementType, StockTransferState } from '@event-commerce/domain';

export interface InventoryLocationInput {
  id: string;
  name: string;
  type: string;
}

export interface InventorySkuInput {
  skuId: string;
  name: string;
  category?: string;
  baseUnit: string;
}

export interface InventoryRecipeInput {
  soldSkuId: string;
  componentSkuId: string;
  quantityPerSoldUnit: string;
}

export interface SalesInventoryMappingInput {
  salesLocationId: string;
  inventoryLocationId: string;
}

export interface InventoryAlertConfigInput {
  id: string;
  inventoryLocationId?: string;
  skuId: string;
  absoluteMinimum: string;
  minutesCoverThreshold: number;
  targetCoverMinutes: number;
  sourceSafetyStock: string;
  eventWideSafetyStock: string;
  imbalanceRatio?: number;
}

export interface InventoryResponsibilityInput {
  id: string;
  inventoryLocationId?: string;
  category?: string;
  responsibleActorId: string;
  escalationActorId?: string;
  priority?: number;
}

export interface InventoryPermissionInput {
  actorId: string;
  permission:
    | 'INVENTORY_MOVE'
    | 'TRANSFER_MANAGE'
    | 'COUNT_MANAGE'
    | 'ALERT_MANAGE'
    | 'INVENTORY_CONFIGURE';
}

export interface InventoryConfigurationSnapshot {
  eventId: string;
  eventEndAt: string;
  shortWindowMinutes?: number;
  mediumWindowMinutes?: number;
  shortWeightBasisPoints?: number;
  escalationMinutes?: number;
  locations: InventoryLocationInput[];
  skus: InventorySkuInput[];
  salesMappings: SalesInventoryMappingInput[];
  recipes: InventoryRecipeInput[];
  alertConfigs: InventoryAlertConfigInput[];
  responsibilities: InventoryResponsibilityInput[];
  permissions: InventoryPermissionInput[];
  sourceActorId: string;
}

export interface ManualMovementInput {
  id: string;
  eventId: string;
  inventoryLocationId: string;
  skuId: string;
  movementType: InventoryMovementType;
  quantityDeltaBase: string;
  actorId: string;
  reason: string;
  occurredAt: string;
  idempotencyKey: string;
  reversalOfLedgerId?: string;
}

export interface TransferLineInput {
  skuId: string;
  requestedQuantityBase: string;
}

export interface CreateTransferInput {
  id: string;
  eventId: string;
  sourceLocationId: string;
  destinationLocationId: string;
  actorId: string;
  reason: string;
  requestedAt: string;
  idempotencyKey: string;
  lines: TransferLineInput[];
}

export interface TransferTransitionInput {
  actorId: string;
  reason?: string;
  assignedActorId?: string;
  occurredAt: string;
}

export interface TransferDispatchInput extends TransferTransitionInput {
  quantities: Array<{ skuId: string; quantityBase: string }>;
}

export interface TransferReceiptInput {
  actorId: string;
  reason?: string;
  receivedAt: string;
  idempotencyKey: string;
  quantities: Array<{ skuId: string; quantityBase: string }>;
}

export interface CreateStockCountInput {
  id: string;
  eventId: string;
  inventoryLocationId: string;
  actorId: string;
  reason: string;
  openedAt: string;
  lines: Array<{ skuId: string; countedQuantityBase: string }>;
}

export interface CloseStockCountInput {
  actorId: string;
  reason: string;
  closedAt: string;
}

export interface AlertTransitionInput {
  actorId: string;
  toState: InventoryAlertState;
  assignedActorId?: string;
  reason?: string;
  occurredAt: string;
}

export interface InventoryProjectionRow {
  eventId: string;
  inventoryLocationId: string;
  skuId: string;
  onHandBase: string;
  inboundBase: string;
  availableBase: string;
}

export interface InventoryAlertRow {
  id: string;
  alertType: string;
  severity: string;
  state: InventoryAlertState;
  eventId: string;
  inventoryLocationId: string | null;
  skuId: string;
  availableQuantityBase: string;
  minutesOfCover: number | null;
  suggestedSourceLocationId: string | null;
  suggestedTransferQuantityBase: string | null;
  responsibleActorId: string | null;
  assignedActorId: string | null;
  openedAt: string;
  escalateAt: string | null;
}

export interface TransferRow {
  id: string;
  eventId: string;
  sourceLocationId: string;
  destinationLocationId: string;
  state: StockTransferState;
  requestedByActorId: string;
  assignedActorId: string | null;
  updatedAt: string;
}
