import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  cloudScriptDatabaseConnectionString,
  migrationChecksum,
  migrationRecordAction,
  validateMigrationInventory,
} from './migration-safety.mjs';

const { Client } = pg;
const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const connectionString = cloudScriptDatabaseConnectionString();

async function connectWithRetry(attempts = 20) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const client = new Client({ connectionString });
    try {
      await client.connect();
      return client;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => undefined);
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw lastError;
}

const client = await connectWithRetry();

try {
  await client.query('SELECT pg_advisory_lock($1)', [2002]);
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      checksum_sha256 text,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum_sha256 text');

  const files = (await readdir(migrationsDirectory))
    .filter((filename) => filename.endsWith('.sql'))
    .sort();
  const ledger = await client.query('SELECT filename FROM schema_migrations ORDER BY filename');
  validateMigrationInventory(
    files,
    ledger.rows.map((row) => row.filename),
  );

  for (const filename of files) {
    const sql = await readFile(join(migrationsDirectory, filename), 'utf8');
    const checksum = migrationChecksum(sql);
    const applied = await client.query(
      'SELECT checksum_sha256 AS "checksumSha256" FROM schema_migrations WHERE filename = $1',
      [filename],
    );

    if (applied.rowCount > 0) {
      const action = migrationRecordAction(applied.rows[0].checksumSha256, checksum);
      if (action === 'BASELINE') {
        await client.query(
          'UPDATE schema_migrations SET checksum_sha256 = $2 WHERE filename = $1 AND checksum_sha256 IS NULL',
          [filename, checksum],
        );
        console.log(`Baselined migration checksum ${filename}`);
      }
      continue;
    }

    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations(filename, checksum_sha256) VALUES ($1, $2)',
        [filename, checksum],
      );
      await client.query('COMMIT');
      console.log(`Applied migration ${filename}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }

  await client.query('ALTER TABLE schema_migrations ALTER COLUMN checksum_sha256 SET NOT NULL');
  await client.query(`
    DO $migration_constraint$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'schema_migrations_checksum_sha256_check'
          AND conrelid = 'schema_migrations'::regclass
      ) THEN
        ALTER TABLE schema_migrations
          ADD CONSTRAINT schema_migrations_checksum_sha256_check
          CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$');
      END IF;
    END
    $migration_constraint$
  `);
} finally {
  await client.query('SELECT pg_advisory_unlock($1)', [2002]).catch(() => undefined);
  await client.end();
}
