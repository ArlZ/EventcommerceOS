function normalizeCurrency(currency: string): string {
  const normalized = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new Error('Enter a valid 3-letter currency code.');
  }
  return normalized;
}

export function currencyFractionDigits(currency: string): number {
  const normalized = normalizeCurrency(currency);
  try {
    const fractionDigits = new Intl.NumberFormat('en', {
      style: 'currency',
      currency: normalized,
    }).resolvedOptions().maximumFractionDigits;
    if (fractionDigits === undefined) {
      throw new Error(`Unsupported currency code: ${normalized}.`);
    }
    return fractionDigits;
  } catch {
    throw new Error(`Unsupported currency code: ${normalized}.`);
  }
}

export function priceToMinorUnits(displayAmount: string, currency: string): number {
  const amount = displayAmount.trim();
  if (!/^\d+(?:\.\d+)?$/.test(amount)) {
    throw new Error('Enter a valid non-negative price.');
  }

  const fractionDigits = currencyFractionDigits(currency);
  const [whole, fraction = ''] = amount.split('.');
  if (fraction.length > fractionDigits) {
    const noun = fractionDigits === 1 ? 'decimal place' : 'decimal places';
    throw new Error(`${normalizeCurrency(currency)} supports up to ${fractionDigits} ${noun}.`);
  }

  const paddedFraction = fraction.padEnd(fractionDigits, '0');
  const minorText = `${whole}${paddedFraction}`.replace(/^0+(?=\d)/, '') || '0';
  const minor = BigInt(minorText);
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Price is too large to save safely.');
  }

  return Number(minor);
}
