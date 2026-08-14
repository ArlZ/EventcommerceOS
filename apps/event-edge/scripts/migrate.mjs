import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const connectionString =
  process.env.EDGE_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://event_commerce:localdev_only@localhost:5432/event_commerce_edge';
const client = new Client({ connectionString });

await client.connect();
try {
  await client.query('SELECT pg_advisory_lock($1)', [4004]);
  await client.query(
    'CREATE TABLE IF NOT EXISTS edge_schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  const files = (await readdir(root)).filter((name) => name.endsWith('.sql')).sort();
  for (const filename of files) {
    const applied = await client.query('SELECT 1 FROM edge_schema_migrations WHERE filename = $1', [
      filename,
    ]);
    if (applied.rowCount) continue;
    await client.query('BEGIN');
    try {
      await client.query(await readFile(join(root, filename), 'utf8'));
      await client.query('INSERT INTO edge_schema_migrations(filename) VALUES ($1)', [filename]);
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
