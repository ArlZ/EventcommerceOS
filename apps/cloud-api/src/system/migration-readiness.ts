import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface MigrationLedgerEntry {
  filename: string;
  checksumSha256: string;
}

function migrationChecksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

export function loadExpectedMigrationLedger(): MigrationLedgerEntry[] {
  const migrationsDirectory = resolve(__dirname, '..', '..', 'migrations');
  return readdirSync(migrationsDirectory)
    .filter((filename) => filename.endsWith('.sql'))
    .sort()
    .map((filename) => ({
      filename,
      checksumSha256: migrationChecksum(
        readFileSync(resolve(migrationsDirectory, filename), 'utf8'),
      ),
    }));
}

const expectedMigrationLedger = loadExpectedMigrationLedger();

export function migrationLedgerIsCurrent(
  actual: readonly MigrationLedgerEntry[],
  expected: readonly MigrationLedgerEntry[] = expectedMigrationLedger,
): boolean {
  if (actual.length !== expected.length) return false;

  return expected.every(
    (entry, index) =>
      actual[index]?.filename === entry.filename &&
      actual[index]?.checksumSha256 === entry.checksumSha256,
  );
}
