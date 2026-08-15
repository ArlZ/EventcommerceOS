import { describe, expect, it } from 'vitest';
import { edgeDatabaseConnectionTimeoutMs } from '../src/database/database.service';

describe('Event Edge database connection timeout configuration', () => {
  it('uses the bounded default', () => {
    expect(edgeDatabaseConnectionTimeoutMs({})).toBe(3_000);
  });

  it('accepts a bounded deployment override', () => {
    expect(edgeDatabaseConnectionTimeoutMs({ EDGE_DATABASE_CONNECTION_TIMEOUT_MS: '5000' })).toBe(
      5_000,
    );
  });

  it.each(['0', '499', '15001', '-1', '1.5', 'not-a-number'])(
    'rejects invalid timeout %s',
    (value) => {
      expect(() =>
        edgeDatabaseConnectionTimeoutMs({ EDGE_DATABASE_CONNECTION_TIMEOUT_MS: value }),
      ).toThrow(/EDGE_DATABASE_CONNECTION_TIMEOUT_MS/);
    },
  );
});
