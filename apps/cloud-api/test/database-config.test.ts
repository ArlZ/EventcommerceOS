import { describe, expect, it } from 'vitest';
import { databaseConnectionTimeoutMs } from '../src/database/database.service';

describe('Cloud database connection timeout configuration', () => {
  it('uses the bounded default', () => {
    expect(databaseConnectionTimeoutMs({})).toBe(5_000);
  });

  it('accepts a bounded deployment override', () => {
    expect(databaseConnectionTimeoutMs({ DATABASE_CONNECTION_TIMEOUT_MS: '8000' })).toBe(8_000);
  });

  it.each(['0', '999', '30001', '-1', '1.5', 'not-a-number'])(
    'rejects invalid timeout %s',
    (value) => {
      expect(() =>
        databaseConnectionTimeoutMs({ DATABASE_CONNECTION_TIMEOUT_MS: value }),
      ).toThrow(/DATABASE_CONNECTION_TIMEOUT_MS/);
    },
  );
});
