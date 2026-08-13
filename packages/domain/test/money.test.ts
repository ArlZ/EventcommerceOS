import { describe, expect, it } from 'vitest';
import { money } from '../src/money';

describe('money', () => {
  it('accepts integer minor units', () => {
    expect(money(25000, 'kes')).toEqual({ amountMinor: 25000, currency: 'KES' });
  });

  it('rejects floating point minor units', () => {
    expect(() => money(99.5, 'KES')).toThrow(/safe integer/);
  });

  it('rejects invalid currency codes', () => {
    expect(() => money(100, 'KSH')).not.toThrow();
    expect(() => money(100, 'KE')).toThrow(/three-letter/);
  });
});
