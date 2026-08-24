import { describe, expect, it } from 'vitest';
import { currencyFractionDigits, priceToMinorUnits } from '../src/app/configuration/pricing';

describe('configuration price entry', () => {
  it('converts a normal KES display price to integer minor units', () => {
    expect(currencyFractionDigits('kes')).toBe(2);
    expect(priceToMinorUnits('250', 'KES')).toBe(25_000);
    expect(priceToMinorUnits('250.50', 'kes')).toBe(25_050);
  });

  it('uses the currency fraction rules rather than assuming two decimals', () => {
    expect(priceToMinorUnits('250', 'JPY')).toBe(250);
    expect(priceToMinorUnits('1.005', 'KWD')).toBe(1_005);
  });

  it('fails closed when the entered amount has too much precision', () => {
    expect(() => priceToMinorUnits('12.345', 'KES')).toThrow(/up to 2 decimal places/);
    expect(() => priceToMinorUnits('12.5', 'JPY')).toThrow(/up to 0 decimal places/);
  });

  it('rejects malformed, negative and unsafe values before an API call', () => {
    expect(() => priceToMinorUnits('', 'KES')).toThrow(/valid non-negative price/);
    expect(() => priceToMinorUnits('-1', 'KES')).toThrow(/valid non-negative price/);
    expect(() => priceToMinorUnits('12,500', 'KES')).toThrow(/valid non-negative price/);
    expect(() => priceToMinorUnits('9007199254740992', 'KES')).toThrow(/too large/);
    expect(() => priceToMinorUnits('250', 'KE')).toThrow(/3-letter currency code/);
  });
});
