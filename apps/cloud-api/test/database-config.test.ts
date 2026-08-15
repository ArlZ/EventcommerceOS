import { describe, expect, it } from 'vitest';
import {
  databaseConnectionString,
  databaseConnectionTimeoutMs,
} from '../src/database/database.service';

describe('Cloud database configuration', () => {
  it('uses the bounded connection timeout default', () => {
    expect(databaseConnectionTimeoutMs({})).toBe(5_000);
  });

  it('accepts a bounded connection timeout override', () => {
    expect(databaseConnectionTimeoutMs({ DATABASE_CONNECTION_TIMEOUT_MS: '8000' })).toBe(8_000);
  });

  it.each(['0', '999', '30001', '-1', '1.5', 'not-a-number'])(
    'rejects invalid timeout %s',
    (value) => {
      expect(() => databaseConnectionTimeoutMs({ DATABASE_CONNECTION_TIMEOUT_MS: value })).toThrow(
        /DATABASE_CONNECTION_TIMEOUT_MS/,
      );
    },
  );

  it('requires an explicit database URL in production', () => {
    expect(() => databaseConnectionString({ NODE_ENV: 'production' })).toThrow(
      /DATABASE_URL is required in production/,
    );
  });

  it('uses the explicit database URL in production', () => {
    const url = 'postgresql://cloud.example/internal';
    expect(databaseConnectionString({ NODE_ENV: 'production', DATABASE_URL: url })).toBe(url);
  });

  it('retains the local development fallback outside production', () => {
    expect(databaseConnectionString({ NODE_ENV: 'test' })).toContain('event_commerce_cloud');
  });
});
