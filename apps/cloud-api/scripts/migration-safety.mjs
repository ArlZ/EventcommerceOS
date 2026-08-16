import { createHash } from 'node:crypto';

const LOCAL_DATABASE_URL =
  'postgresql://event_commerce:localdev_only@localhost:5432/event_commerce_cloud';

export function cloudScriptDatabaseConnectionString(environment = process.env) {
  const configured = environment.DATABASE_URL?.trim();
  if (configured) return configured;
  if (environment.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL is required for production database tooling');
  }
  return LOCAL_DATABASE_URL;
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
