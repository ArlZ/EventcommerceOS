import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

const { Client } = pg;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optional(name) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function bool(name, fallback = false) {
  const value = optional(name);
  if (value === undefined) return fallback;
  if (value !== 'true' && value !== 'false') throw new Error(`${name} must be true or false`);
  return value === 'true';
}

function positiveInteger(name) {
  const raw = required(name);
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be a positive integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function parseDatabaseUrl(name, value) {
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error(`${name} must be a PostgreSQL URL`);
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database) throw new Error(`${name} must include a database name`);
  return {
    raw: value,
    host: url.hostname,
    port: url.port || '5432',
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    sslmode: url.searchParams.get('sslmode') ?? undefined,
  };
}

function pgToolEnv(database) {
  const env = {
    ...process.env,
    PGHOST: database.host,
    PGPORT: database.port,
    PGUSER: database.user,
    PGPASSWORD: database.password,
    PGDATABASE: database.database,
    PGCONNECT_TIMEOUT: process.env.PGCONNECT_TIMEOUT ?? '10',
  };
  if (database.sslmode) env.PGSSLMODE = database.sslmode;
  delete env.DATABASE_URL;
  delete env.RESTORE_DATABASE_URL;
  return env;
}

function sameDatabase(left, right) {
  return left.host === right.host && left.port === right.port && left.database === right.database;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function run(command, args, options = {}) {
  const startedAt = Date.now();
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      env: options.env ?? process.env,
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', rejectPromise);
    child.on('exit', (code, signal) => {
      if (code !== 0) {
        rejectPromise(
          new Error(
            `${command} failed with ${signal ? `signal ${signal}` : `exit ${code}`}${
              stderr.trim() ? `: ${stderr.trim()}` : ''
            }`,
          ),
        );
        return;
      }
      resolvePromise({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

async function sha256File(path) {
  const bytes = await readFile(path);
  return createHash('sha256').update(bytes).digest('hex');
}

async function tablePrimaryKey(client, tableName) {
  const rows = await client.query(
    `SELECT attribute.attname AS column_name
     FROM pg_index index_definition
     JOIN pg_class table_definition ON table_definition.oid=index_definition.indrelid
     JOIN pg_namespace namespace ON namespace.oid=table_definition.relnamespace
     JOIN LATERAL unnest(index_definition.indkey) WITH ORDINALITY key(attnum, ordinal) ON true
     JOIN pg_attribute attribute
       ON attribute.attrelid=table_definition.oid AND attribute.attnum=key.attnum
     WHERE namespace.nspname='public'
       AND table_definition.relname=$1
       AND index_definition.indisprimary
     ORDER BY key.ordinal`,
    [tableName],
  );
  return rows.rows.map((row) => row.column_name);
}

async function publicTableNames(client) {
  const rows = await client.query(
    `SELECT tablename
     FROM pg_tables
     WHERE schemaname='public'
     ORDER BY tablename`,
  );
  return rows.rows.map((row) => row.tablename);
}

async function tableFingerprint(client, tableName) {
  const primaryKey = await tablePrimaryKey(client, tableName);
  const table = quoteIdentifier(tableName);
  const orderExpression =
    primaryKey.length > 0
      ? primaryKey.map((column) => `t.${quoteIdentifier(column)}::text`).join(', ')
      : 'to_jsonb(t)::text';
  const result = await client.query(
    `SELECT count(*)::text AS row_count,
            COALESCE(
              md5(string_agg(md5(to_jsonb(t)::text), '' ORDER BY ${orderExpression})),
              md5('')
            ) AS fingerprint
     FROM public.${table} t`,
  );
  const row = result.rows[0];
  return {
    rowCount: row?.row_count ?? '0',
    fingerprint: row?.fingerprint ?? createHash('md5').update('').digest('hex'),
    primaryKey,
  };
}

async function databaseFingerprint(client) {
  const tables = await publicTableNames(client);
  const fingerprints = {};
  for (const table of tables) fingerprints[table] = await tableFingerprint(client, table);
  return { tables, fingerprints };
}

function count(snapshot, table) {
  return BigInt(snapshot.fingerprints[table]?.rowCount ?? '0');
}

function representativeChecks(snapshot) {
  const auditCount =
    count(snapshot, 'audit_events') +
    count(snapshot, 'payment_audit_events') +
    count(snapshot, 'event_close_actions') +
    count(snapshot, 'operator_auth_audit') +
    count(snapshot, 'edge_sync_client_audit');
  return {
    configuration: count(snapshot, 'organisations') > 0n && count(snapshot, 'events') > 0n,
    commerce: count(snapshot, 'sync_order_state') > 0n,
    payments: count(snapshot, 'payments') > 0n && count(snapshot, 'payment_attempts') > 0n,
    inventory: count(snapshot, 'inventory_ledger') > 0n,
    audit: auditCount > 0n,
    close: count(snapshot, 'event_close_reports') > 0n,
    machineSecurity: count(snapshot, 'edge_sync_clients') > 0n,
    humanSecurity: count(snapshot, 'operator_identities') > 0n,
  };
}

function compareFingerprints(source, restored) {
  const errors = [];
  if (JSON.stringify(source.tables) !== JSON.stringify(restored.tables)) {
    errors.push('public table list differs after restore');
  }
  const allTables = [...new Set([...source.tables, ...restored.tables])].sort();
  for (const table of allTables) {
    const left = source.fingerprints[table];
    const right = restored.fingerprints[table];
    if (!left || !right) {
      errors.push(`${table}: missing on ${left ? 'restore' : 'source'}`);
      continue;
    }
    if (left.rowCount !== right.rowCount) {
      errors.push(`${table}: row count ${left.rowCount} != ${right.rowCount}`);
    }
    if (left.fingerprint !== right.fingerprint) {
      errors.push(`${table}: content fingerprint mismatch`);
    }
  }
  return errors;
}

async function resetRestoreTarget(client, restoreDatabase) {
  const acknowledgement = required('RESTORE_TARGET_RESET_ACK');
  const expected = `RESET:${restoreDatabase.database}`;
  if (acknowledgement !== expected) {
    throw new Error(`RESTORE_TARGET_RESET_ACK must exactly equal ${expected}`);
  }
  await client.query('DROP SCHEMA IF EXISTS public CASCADE');
  await client.query('CREATE SCHEMA public');
}

function publicDatabaseDescriptor(database) {
  return { host: database.host, port: database.port, database: database.database };
}

const sourceUrl = required('DATABASE_URL');
const restoreUrl = required('RESTORE_DATABASE_URL');
const sourceDatabase = parseDatabaseUrl('DATABASE_URL', sourceUrl);
const restoreDatabase = parseDatabaseUrl('RESTORE_DATABASE_URL', restoreUrl);
if (sameDatabase(sourceDatabase, restoreDatabase)) {
  throw new Error('RESTORE_DATABASE_URL must point to a different isolated database');
}

const operator = required('BACKUP_OPERATOR');
const releaseCommitSha = required('RELEASE_COMMIT_SHA');
if (!/^[0-9a-f]{7,64}$/i.test(releaseCommitSha)) {
  throw new Error('RELEASE_COMMIT_SHA must be a Git commit SHA');
}
const rpoTargetMinutes = positiveInteger('BACKUP_RPO_TARGET_MINUTES');
const rtoTargetMinutes = positiveInteger('BACKUP_RTO_TARGET_MINUTES');
const requireRepresentative = bool('BACKUP_REQUIRE_REPRESENTATIVE_DATA', true);
const keepDump = bool('BACKUP_KEEP_DUMP', false);
const liveData = process.env.NODE_ENV === 'production' || bool('BACKUP_LIVE_DATA', false);
if (liveData && process.env.BACKUP_ENCRYPTED_STORAGE_CONFIRMED !== 'true') {
  throw new Error(
    'BACKUP_ENCRYPTED_STORAGE_CONFIRMED=true is required before writing a live-data dump',
  );
}

const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const outputRoot = resolve(optional('BACKUP_OUTPUT_DIR') ?? 'artifacts/backup-restore');
const outputDir = resolve(outputRoot, `${runId}-${releaseCommitSha.slice(0, 12)}`);
await mkdir(outputDir, { recursive: true, mode: 0o700 });
const dumpPath = resolve(outputDir, 'cloud-backup.dump');
const evidencePath = resolve(outputDir, 'backup-restore-evidence.json');
const checksumPath = resolve(outputDir, 'cloud-backup.dump.sha256');

const versions = {};
versions.pgDump = (await run('pg_dump', ['--version'], { capture: true })).stdout;
versions.pgRestore = (await run('pg_restore', ['--version'], { capture: true })).stdout;

const sourceClient = new Client({ connectionString: sourceUrl });
const restoreClient = new Client({ connectionString: restoreUrl });
let sourceSnapshot;
let snapshotAt;
let dumpResult;
let archiveValidation;
let dumpSha256;
let dumpBytes;
let restoreResult;
let restoredSnapshot;
let restoreStartedAt;
let restoreCompletedAt;

try {
  await sourceClient.connect();
  await sourceClient.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const snapshotRow = await sourceClient.query(
    `SELECT pg_export_snapshot() AS snapshot_id,
            transaction_timestamp() AS snapshot_at`,
  );
  const snapshotId = snapshotRow.rows[0]?.snapshot_id;
  snapshotAt = new Date(snapshotRow.rows[0]?.snapshot_at);
  if (!snapshotId || Number.isNaN(snapshotAt.getTime())) {
    throw new Error('failed to export a consistent PostgreSQL source snapshot');
  }

  sourceSnapshot = await databaseFingerprint(sourceClient);
  const representative = representativeChecks(sourceSnapshot);
  if (requireRepresentative) {
    const missing = Object.entries(representative)
      .filter(([, present]) => !present)
      .map(([name]) => name);
    if (missing.length > 0) {
      throw new Error(
        `representative release data is missing for: ${missing.join(', ')}; set BACKUP_REQUIRE_REPRESENTATIVE_DATA=false only for a non-release smoke drill`,
      );
    }
  }

  dumpResult = await run(
    'pg_dump',
    [
      '--format=custom',
      '--no-owner',
      '--no-privileges',
      '--snapshot',
      snapshotId,
      '--file',
      dumpPath,
    ],
    { env: pgToolEnv(sourceDatabase) },
  );
  await chmod(dumpPath, 0o600);
  await sourceClient.query('COMMIT');

  const dumpStat = await stat(dumpPath);
  dumpBytes = dumpStat.size;
  dumpSha256 = await sha256File(dumpPath);
  await writeFile(checksumPath, `${dumpSha256}  cloud-backup.dump\n`, { mode: 0o600 });
  archiveValidation = await run('pg_restore', ['--list', dumpPath], { capture: true });

  await restoreClient.connect();
  await resetRestoreTarget(restoreClient, restoreDatabase);
  restoreStartedAt = new Date();
  restoreResult = await run(
    'pg_restore',
    [
      '--exit-on-error',
      '--no-owner',
      '--no-privileges',
      '--dbname',
      restoreDatabase.database,
      dumpPath,
    ],
    { env: pgToolEnv(restoreDatabase) },
  );
  restoreCompletedAt = new Date();
  restoredSnapshot = await databaseFingerprint(restoreClient);

  const mismatches = compareFingerprints(sourceSnapshot, restoredSnapshot);
  if (mismatches.length > 0) {
    throw new Error(`restore fingerprint verification failed:\n- ${mismatches.join('\n- ')}`);
  }

  const recoveryPointAgeAtRestoreStartMs = Math.max(
    0,
    restoreStartedAt.getTime() - snapshotAt.getTime(),
  );
  const rpoTargetMs = rpoTargetMinutes * 60_000;
  const rtoTargetMs = rtoTargetMinutes * 60_000;
  const evidence = {
    schemaVersion: 1,
    result: 'PASS',
    releaseCommitSha,
    operator,
    source: publicDatabaseDescriptor(sourceDatabase),
    restoreTarget: publicDatabaseDescriptor(restoreDatabase),
    sourceSnapshotAt: snapshotAt.toISOString(),
    backupCompletedAt: new Date(snapshotAt.getTime() + dumpResult.durationMs).toISOString(),
    restoreStartedAt: restoreStartedAt.toISOString(),
    restoreCompletedAt: restoreCompletedAt.toISOString(),
    backupDurationMs: dumpResult.durationMs,
    restoreDurationMs: restoreResult.durationMs,
    recoveryPointAgeAtRestoreStartMs,
    targets: {
      rpoMinutes: rpoTargetMinutes,
      rtoMinutes: rtoTargetMinutes,
      drillRecoveryPointWithinRpoTarget: recoveryPointAgeAtRestoreStartMs <= rpoTargetMs,
      restoreWithinRtoTarget: restoreResult.durationMs <= rtoTargetMs,
      note: 'Operational RPO also depends on real backup cadence; this drill measures the age of this recovery point when restore begins.',
    },
    dump: {
      sha256: dumpSha256,
      bytes: dumpBytes,
      retained: keepDump,
      archiveListValidated: archiveValidation.stdout.length > 0,
      encryptedStorageConfirmed: liveData
        ? true
        : process.env.BACKUP_ENCRYPTED_STORAGE_CONFIRMED === 'true',
    },
    representativeData: representativeChecks(sourceSnapshot),
    publicTableCount: sourceSnapshot.tables.length,
    tableFingerprints: sourceSnapshot.fingerprints,
    toolVersions: versions,
  };

  if (!evidence.targets.drillRecoveryPointWithinRpoTarget) {
    throw new Error(
      `recovery point age ${recoveryPointAgeAtRestoreStartMs}ms exceeded configured RPO target ${rpoTargetMs}ms`,
    );
  }
  if (!evidence.targets.restoreWithinRtoTarget) {
    throw new Error(
      `restore duration ${restoreResult.durationMs}ms exceeded configured RTO target ${rtoTargetMs}ms`,
    );
  }

  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  if (!keepDump) await rm(dumpPath, { force: true });

  console.log(`Backup/restore verification PASS: ${evidencePath}`);
  console.log(`Dump SHA-256: ${dumpSha256}`);
  console.log(`Backup duration: ${dumpResult.durationMs} ms`);
  console.log(`Restore duration: ${restoreResult.durationMs} ms`);
  console.log(`Public tables verified: ${sourceSnapshot.tables.length}`);
} catch (error) {
  await sourceClient.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  await sourceClient.end().catch(() => undefined);
  await restoreClient.end().catch(() => undefined);
}
