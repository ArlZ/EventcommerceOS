import { describe, expect, it } from 'vitest';
import { fixedClock } from '../src';

describe('fixedClock', () => {
  it('returns independent Date instances at a fixed instant', () => {
    const clock = fixedClock('2026-01-01T00:00:00.000Z');
    expect(clock().toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(clock()).not.toBe(clock());
  });
});
