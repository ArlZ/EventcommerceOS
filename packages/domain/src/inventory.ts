export const INVENTORY_MOVEMENT_TYPES = [
  'RECEIPT',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'SALE',
  'RECIPE_CONSUMPTION',
  'WASTAGE',
  'BREAKAGE',
  'COMP',
  'COUNT_ADJUSTMENT',
  'RETURN_TO_WAREHOUSE',
  'SUPPLIER_RETURN',
  'REVERSAL',
] as const;

export type InventoryMovementType = (typeof INVENTORY_MOVEMENT_TYPES)[number];

export const STOCK_TRANSFER_STATES = [
  'REQUESTED',
  'ASSIGNED',
  'PICKING',
  'IN_TRANSIT',
  'RECEIVED',
  'CANCELLED',
] as const;

export type StockTransferState = (typeof STOCK_TRANSFER_STATES)[number];

export const ALERT_STATES = ['OPEN', 'ACKNOWLEDGED', 'ASSIGNED', 'RESOLVED'] as const;
export type InventoryAlertState = (typeof ALERT_STATES)[number];

const positiveMovements = new Set<InventoryMovementType>(['RECEIPT', 'TRANSFER_IN']);
const negativeMovements = new Set<InventoryMovementType>([
  'TRANSFER_OUT',
  'SALE',
  'RECIPE_CONSUMPTION',
  'WASTAGE',
  'BREAKAGE',
  'COMP',
  'RETURN_TO_WAREHOUSE',
  'SUPPLIER_RETURN',
]);

export function requireInventoryDelta(
  type: InventoryMovementType,
  quantityDeltaBase: bigint,
): bigint {
  if (quantityDeltaBase === 0n) throw new Error('inventory movement quantity must not be zero');
  if (positiveMovements.has(type) && quantityDeltaBase < 0n) {
    throw new Error(`${type} inventory movement must increase stock`);
  }
  if (negativeMovements.has(type) && quantityDeltaBase > 0n) {
    throw new Error(`${type} inventory movement must decrease stock`);
  }
  return quantityDeltaBase;
}

export function consumeRecipe(soldQuantity: bigint, componentQuantityPerUnit: bigint): bigint {
  if (soldQuantity <= 0n) throw new Error('sold quantity must be positive');
  if (componentQuantityPerUnit <= 0n) {
    throw new Error('recipe component quantity per unit must be positive');
  }
  return soldQuantity * componentQuantityPerUnit;
}

const transferTransitions: Record<StockTransferState, readonly StockTransferState[]> = {
  REQUESTED: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['PICKING', 'CANCELLED'],
  PICKING: ['IN_TRANSIT', 'CANCELLED'],
  IN_TRANSIT: ['RECEIVED'],
  RECEIVED: [],
  CANCELLED: [],
};

export function requireTransferTransition(
  from: StockTransferState,
  to: StockTransferState,
): StockTransferState {
  if (!transferTransitions[from].includes(to)) {
    throw new Error(`invalid stock transfer transition ${from} -> ${to}`);
  }
  return to;
}

const alertTransitions: Record<InventoryAlertState, readonly InventoryAlertState[]> = {
  OPEN: ['ACKNOWLEDGED', 'ASSIGNED', 'RESOLVED'],
  ACKNOWLEDGED: ['ASSIGNED', 'RESOLVED'],
  ASSIGNED: ['RESOLVED'],
  RESOLVED: [],
};

export function requireAlertTransition(
  from: InventoryAlertState,
  to: InventoryAlertState,
): InventoryAlertState {
  if (!alertTransitions[from].includes(to)) {
    throw new Error(`invalid inventory alert transition ${from} -> ${to}`);
  }
  return to;
}

export interface ConsumptionSample {
  occurredAtEpochMs: number;
  quantityBase: bigint;
}

export interface VelocityOptions {
  shortWindowMinutes?: number;
  mediumWindowMinutes?: number;
  shortWeightBasisPoints?: number;
}

function positiveWindow(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`);
  return value;
}

function quantityAsNumber(value: bigint): number {
  const converted = Number(value);
  if (!Number.isSafeInteger(converted)) {
    throw new Error('inventory quantity exceeds safe calculation range');
  }
  return converted;
}

export function blendedVelocityPerMinute(
  samples: readonly ConsumptionSample[],
  nowEpochMs: number,
  options: VelocityOptions = {},
): number {
  if (!Number.isFinite(nowEpochMs)) throw new Error('nowEpochMs must be finite');
  const shortMinutes = positiveWindow(options.shortWindowMinutes ?? 10, 'short window');
  const mediumMinutes = positiveWindow(options.mediumWindowMinutes ?? 30, 'medium window');
  if (mediumMinutes < shortMinutes)
    throw new Error('medium window must not be shorter than short window');

  const shortWeight = options.shortWeightBasisPoints ?? 6000;
  if (!Number.isInteger(shortWeight) || shortWeight < 0 || shortWeight > 10_000) {
    throw new Error('short weight must be between 0 and 10000 basis points');
  }

  let shortQuantity = 0n;
  let mediumQuantity = 0n;
  const shortCutoff = nowEpochMs - shortMinutes * 60_000;
  const mediumCutoff = nowEpochMs - mediumMinutes * 60_000;

  for (const sample of samples) {
    if (!Number.isFinite(sample.occurredAtEpochMs)) throw new Error('sample time must be finite');
    if (sample.quantityBase < 0n)
      throw new Error('consumption sample quantity must not be negative');
    if (sample.occurredAtEpochMs > nowEpochMs || sample.occurredAtEpochMs <= mediumCutoff) continue;
    mediumQuantity += sample.quantityBase;
    if (sample.occurredAtEpochMs > shortCutoff) shortQuantity += sample.quantityBase;
  }

  const shortRate = quantityAsNumber(shortQuantity) / shortMinutes;
  const mediumRate = quantityAsNumber(mediumQuantity) / mediumMinutes;
  const shortFraction = shortWeight / 10_000;
  return shortRate * shortFraction + mediumRate * (1 - shortFraction);
}

export function minutesOfCover(availableBase: bigint, velocityPerMinute: number): number | null {
  if (availableBase <= 0n) return 0;
  if (!Number.isFinite(velocityPerMinute) || velocityPerMinute < 0) {
    throw new Error('velocity must be finite and non-negative');
  }
  if (velocityPerMinute <= 1e-9) return null;
  return quantityAsNumber(availableBase) / velocityPerMinute;
}

export interface StockRiskInput {
  availableBase: bigint;
  absoluteMinimumBase: bigint;
  velocityPerMinute: number;
  minutesCoverThreshold: number;
  eventMinutesRemaining: number;
}

export interface StockRiskResult {
  belowAbsoluteMinimum: boolean;
  minutesOfCover: number | null;
  belowCoverThreshold: boolean;
  projectedStockoutBeforeEventEnd: boolean;
}

export function evaluateStockRisk(input: StockRiskInput): StockRiskResult {
  if (input.absoluteMinimumBase < 0n) throw new Error('absolute minimum must not be negative');
  if (!Number.isFinite(input.minutesCoverThreshold) || input.minutesCoverThreshold < 0) {
    throw new Error('minutes cover threshold must be finite and non-negative');
  }
  if (!Number.isFinite(input.eventMinutesRemaining) || input.eventMinutesRemaining < 0) {
    throw new Error('event minutes remaining must be finite and non-negative');
  }
  const cover = minutesOfCover(input.availableBase, input.velocityPerMinute);
  return {
    belowAbsoluteMinimum: input.availableBase <= input.absoluteMinimumBase,
    minutesOfCover: cover,
    belowCoverThreshold: cover !== null && cover <= input.minutesCoverThreshold,
    projectedStockoutBeforeEventEnd: cover !== null && cover <= input.eventMinutesRemaining,
  };
}

export interface ReplenishmentInput {
  destinationAvailableBase: bigint;
  destinationInboundBase: bigint;
  sourceAvailableBase: bigint;
  sourceSafetyStockBase: bigint;
  velocityPerMinute: number;
  targetCoverMinutes: number;
}

export function recommendedTransferQuantity(input: ReplenishmentInput): bigint {
  if (input.destinationInboundBase < 0n)
    throw new Error('destination inbound stock must not be negative');
  if (input.sourceSafetyStockBase < 0n) throw new Error('source safety stock must not be negative');
  if (!Number.isFinite(input.velocityPerMinute) || input.velocityPerMinute < 0) {
    throw new Error('velocity must be finite and non-negative');
  }
  if (!Number.isFinite(input.targetCoverMinutes) || input.targetCoverMinutes < 0) {
    throw new Error('target cover must be finite and non-negative');
  }

  const targetBase = BigInt(Math.ceil(input.velocityPerMinute * input.targetCoverMinutes));
  const destinationEffective = input.destinationAvailableBase + input.destinationInboundBase;
  const needed = targetBase > destinationEffective ? targetBase - destinationEffective : 0n;
  const sourceSurplus =
    input.sourceAvailableBase > input.sourceSafetyStockBase
      ? input.sourceAvailableBase - input.sourceSafetyStockBase
      : 0n;
  return needed < sourceSurplus ? needed : sourceSurplus;
}
