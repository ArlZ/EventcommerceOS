import { createHash } from 'node:crypto';

const LOCAL_EDGE_DATABASE_URL =
  'postgresql://event_commerce:localdev_only@localhost:5432/event_commerce_edge';

export function edgeScriptDatabaseConnectionString(environment = process.env) {
  const configured = environment.EDGE_DATABASE_URL?.trim();
  if (configured) return configured;
  if (environment.NODE_ENV === 'production') {
    throw new Error('EDGE_DATABASE_URL is required for production database tooling');
  }
  return environment.DATABASE_URL?.trim() || LOCAL_EDGE_DATABASE_URL;
}

export function migrationChecksum(sql) {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

export function migrationRecordAction(storedChecksum, expectedChecksum) {
  if (storedChecksum == null) return 'BASELINE';
  if (storedChecksum === expectedChecksum) return 'MATCH';
  throw new Error(
    `Applied migration checksum mismatch: stored ${storedChecksum}, current ${expectedChecksum}`,
  );
}
