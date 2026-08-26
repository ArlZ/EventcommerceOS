import { describe, expect, it } from 'vitest';
import {
  loadExpectedMigrationLedger,
  migrationLedgerIsCurrent,
  type MigrationLedgerEntry,
} from '../src/system/migration-readiness';

describe('database migration readiness', () => {
  const expected = loadExpectedMigrationLedger();

  it('accepts the exact packaged migration ledger', () => {
    expect(migrationLedgerIsCurrent(expected, expected)).toBe(true);
  });

  it('fails closed when a migration is missing', () => {
    expect(migrationLedgerIsCurrent(expected.slice(0, -1), expected)).toBe(false);
  });

  it('fails closed when a migration checksum differs', () => {
    const actual: MigrationLedgerEntry[] = expected.map((entry, index) =>
      index === expected.length - 1 ? { ...entry, checksumSha256: '0'.repeat(64) } : entry,
    );

    expect(migrationLedgerIsCurrent(actual, expected)).toBe(false);
  });

  it('fails closed when migration order differs or extra history exists', () => {
    const reversed = [...expected].reverse();
    const extra = [...expected, { filename: '9999_unexpected.sql', checksumSha256: '0'.repeat(64) }];

    expect(migrationLedgerIsCurrent(reversed, expected)).toBe(false);
    expect(migrationLedgerIsCurrent(extra, expected)).toBe(false);
  });
});
