import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  edgeScriptDatabaseConnectionString,
  migrationChecksum,
  migrationRecordAction,
} from './migration-safety.mjs';

const { Client } = pg;
const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const connectionString = edgeScriptDatabaseConnectionString();
const client = new Client({ connectionString });

await client.connect();
try {
  await client.query('SELECT pg_advisory_lock($1)', [4004]);
  await client.query(
    'CREATE TABLE IF NOT EXISTS edge_schema_migrations (filename text PRIMARY KEY, checksum_sha256 text, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  await client.query(
    'ALTER TABLE edge_schema_migrations ADD COLUMN IF NOT EXISTS checksum_sha256 text',
  );

  const files = (await readdir(root)).filter((name) => name.endsWith('.sql')).sort();
  for (const filename of files) {
    const sql = await readFile(join(root, filename), 'utf8');
    const checksum = migrationChecksum(sql);
    const applied = await client.query(
      'SELECT checksum_sha256 AS "checksumSha256" FROM edge_schema_migrations WHERE filename = $1',
      [filename],
    );

    if (applied.rowCount) {
      const action = migrationRecordAction(applied.rows[0].checksumSha256, checksum);
      if (action === 'BASELINE') {
        await client.query(
          'UPDATE edge_schema_migrations SET checksum_sha256 = $2 WHERE filename = $1 AND checksum_sha256 IS NULL',
          [filename, checksum],
        );
        console.log(`Baselined edge migration checksum ${filename}`);
      }
      continue;
    }

    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query(
        'INSERT INTO edge_schema_migrations(filename, checksum_sha256) VALUES ($1, $2)',
        [filename, checksum],
      );
      await client.query('COMMIT');
      console.log(`Applied edge migration ${filename}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
} finally {
  await client.query('SELECT pg_advisory_unlock($1)', [4004]).catch(() => undefined);
  await client.end();
}
