import { describe, expect, it } from 'vitest';
import {
  blendedVelocityPerMinute,
  consumeRecipe,
  evaluateStockRisk,
  minutesOfCover,
  recommendedTransferQuantity,
  requireAlertTransition,
  requireInventoryDelta,
  requireTransferTransition,
} from '../src/inventory';

describe('inventory domain rules', () => {
  it('enforces inventory movement direction while allowing signed adjustments and reversals', () => {
    expect(requireInventoryDelta('RECEIPT', 10n)).toBe(10n);
    expect(requireInventoryDelta('SALE', -2n)).toBe(-2n);
    expect(requireInventoryDelta('COUNT_ADJUSTMENT', -3n)).toBe(-3n);
    expect(requireInventoryDelta('REVERSAL', 3n)).toBe(3n);
    expect(() => requireInventoryDelta('RECEIPT', -1n)).toThrow(/increase stock/);
    expect(() => requireInventoryDelta('WASTAGE', 1n)).toThrow(/decrease stock/);
  });

  it('converts recipes exactly in integer base units', () => {
    expect(consumeRecipe(7n, 35n)).toBe(245n);
    expect(consumeRecipe(3n, 330n)).toBe(990n);
    expect(() => consumeRecipe(1n, 0n)).toThrow(/positive/);
  });

  it('enforces transfer and alert state machines', () => {
    expect(requireTransferTransition('REQUESTED', 'ASSIGNED')).toBe('ASSIGNED');
    expect(requireTransferTransition('PICKING', 'IN_TRANSIT')).toBe('IN_TRANSIT');
    expect(() => requireTransferTransition('IN_TRANSIT', 'CANCELLED')).toThrow(/invalid/);
    expect(requireAlertTransition('OPEN', 'ACKNOWLEDGED')).toBe('ACKNOWLEDGED');
    expect(requireAlertTransition('ACKNOWLEDGED', 'ASSIGNED')).toBe('ASSIGNED');
    expect(() => requireAlertTransition('RESOLVED', 'OPEN')).toThrow(/invalid/);
  });

  it('returns no finite cover at zero velocity and reacts deterministically to a recent spike', () => {
    const now = 1_800_000_000_000;
    expect(blendedVelocityPerMinute([], now)).toBe(0);
    expect(minutesOfCover(100n, 0)).toBeNull();

    const velocity = blendedVelocityPerMinute(
      [
        { occurredAtEpochMs: now - 5 * 60_000, quantityBase: 100n },
        { occurredAtEpochMs: now - 20 * 60_000, quantityBase: 60n },
      ],
      now,
    );
    expect(velocity).toBeCloseTo(8.1333333333, 6);
    expect(minutesOfCover(81n, velocity)).toBeCloseTo(9.959, 2);
  });

  it('detects location stockout risk without assuming event-wide shortage', () => {
    const risk = evaluateStockRisk({
      availableBase: 31n,
      absoluteMinimumBase: 40n,
      velocityPerMinute: 3.5,
      minutesCoverThreshold: 15,
      eventMinutesRemaining: 120,
    });
    expect(risk.belowAbsoluteMinimum).toBe(true);
    expect(risk.belowCoverThreshold).toBe(true);
    expect(risk.projectedStockoutBeforeEventEnd).toBe(true);
  });

  it('replenishment accounts for inbound stock and never takes a source below safety stock', () => {
    expect(
      recommendedTransferQuantity({
        destinationAvailableBase: 30n,
        destinationInboundBase: 20n,
        sourceAvailableBase: 200n,
        sourceSafetyStockBase: 80n,
        velocityPerMinute: 2,
        targetCoverMinutes: 60,
      }),
    ).toBe(70n);

    expect(
      recommendedTransferQuantity({
        destinationAvailableBase: 0n,
        destinationInboundBase: 0n,
        sourceAvailableBase: 100n,
        sourceSafetyStockBase: 80n,
        velocityPerMinute: 5,
        targetCoverMinutes: 60,
      }),
    ).toBe(20n);
  });
});
