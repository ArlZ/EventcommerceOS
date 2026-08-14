import { describe, expect, it } from 'vitest';
import { isStockImbalanced } from '../src/inventory-imbalance';

describe('stock imbalance', () => {
  it('uses source surplus, inbound destination stock and configured ratio', () => {
    expect(
      isStockImbalanced({
        destinationAvailableBase: 20n,
        destinationInboundBase: 0n,
        sourceAvailableBase: 300n,
        sourceSafetyStockBase: 80n,
        minimumRatio: 2,
      }),
    ).toBe(true);

    expect(
      isStockImbalanced({
        destinationAvailableBase: 20n,
        destinationInboundBase: 100n,
        sourceAvailableBase: 300n,
        sourceSafetyStockBase: 80n,
        minimumRatio: 2,
      }),
    ).toBe(false);
  });

  it('treats a zero-stock destination with source surplus as imbalanced', () => {
    expect(
      isStockImbalanced({
        destinationAvailableBase: 0n,
        destinationInboundBase: 0n,
        sourceAvailableBase: 50n,
        sourceSafetyStockBase: 10n,
        minimumRatio: 3,
      }),
    ).toBe(true);
  });
});
