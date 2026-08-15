import { describe, expect, it } from 'vitest';
import {
  edgeDatabaseConnectionString,
  edgeDatabaseConnectionTimeoutMs,
} from '../src/database/database.service';

describe('Event Edge database configuration', () => {
  it('uses the bounded connection timeout default', () => {
    expect(edgeDatabaseConnectionTimeoutMs({})).toBe(3_000);
  });

  it('accepts a bounded connection timeout override', () => {
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

  it('requires an explicit Edge database URL in production', () => {
    expect(() =>
      edgeDatabaseConnectionString({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://cloud.example/should-not-be-reused',
      }),
    ).toThrow(/EDGE_DATABASE_URL is required in production/);
  });

  it('uses the explicit Edge database URL in production', () => {
    const url = 'postgresql://edge.example/internal';
    expect(edgeDatabaseConnectionString({ NODE_ENV: 'production', EDGE_DATABASE_URL: url })).toBe(
      url,
    );
  });

  it('retains the shared development fallback outside production', () => {
    const url = 'postgresql://local.example/dev';
    expect(edgeDatabaseConnectionString({ NODE_ENV: 'test', DATABASE_URL: url })).toBe(url);
  });
});
