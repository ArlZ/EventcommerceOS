export type CurrencyCode = string & { readonly __currencyCode: unique symbol };

export interface Money {
  amountMinor: number;
  currency: CurrencyCode;
}

export function asCurrencyCode(value: string): CurrencyCode {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new Error('Currency must be a three-letter ISO-style code');
  }
  return normalized as CurrencyCode;
}

export function money(amountMinor: number, currency: string): Money {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new Error('Money amountMinor must be a non-negative safe integer');
  }
  return { amountMinor, currency: asCurrencyCode(currency) };
}
