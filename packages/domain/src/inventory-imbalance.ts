export interface StockImbalanceInput {
  destinationAvailableBase: bigint;
  destinationInboundBase: bigint;
  sourceAvailableBase: bigint;
  sourceSafetyStockBase: bigint;
  minimumRatio: number;
}

export function isStockImbalanced(input: StockImbalanceInput): boolean {
  if (input.destinationInboundBase < 0n)
    throw new Error('destination inbound stock must not be negative');
  if (input.sourceSafetyStockBase < 0n) throw new Error('source safety stock must not be negative');
  if (!Number.isFinite(input.minimumRatio) || input.minimumRatio < 1) {
    throw new Error('imbalance ratio must be finite and at least 1');
  }

  const sourceSurplus =
    input.sourceAvailableBase > input.sourceSafetyStockBase
      ? input.sourceAvailableBase - input.sourceSafetyStockBase
      : 0n;
  if (sourceSurplus <= 0n) return false;

  const destinationEffective = input.destinationAvailableBase + input.destinationInboundBase;
  if (destinationEffective <= 0n) return true;

  const ratioBasisPoints = BigInt(Math.ceil(input.minimumRatio * 10_000));
  return sourceSurplus * 10_000n >= destinationEffective * ratioBasisPoints;
}
