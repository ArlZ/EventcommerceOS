import { fileURLToPath } from 'node:url';

const SHA_PATTERN = /^[0-9a-f]{40}$/;

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function asSafeInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return parsed;
}

function asBigIntString(value, label) {
  const text = String(value ?? '');
  if (!/^-?\d+$/.test(text)) throw new Error(`${label} must be an integer`);
  return text;
}

function isoOrNull(value) {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`invalid database timestamp ${String(value)}`);
  }
  return date.toISOString();
}

function mapBy(rows, key) {
  return new Map(rows.map((row) => [row[key], row]));
}

export async function collectEdgeFieldDiagnostics(client, env = process.env, now = new Date()) {
  const releaseCommit = required(env, 'RELEASE_COMMIT');
  if (!SHA_PATTERN.test(releaseCommit)) {
    throw new Error('RELEASE_COMMIT must be a lowercase 40-character Git SHA');
  }
  const edgeId = required(env, 'EDGE_ID');
  const eventId = required(env, 'PILOT_EVENT_ID');

  const [watermarks, processed, backlog, exceptions, stock, transfers, counts, payments] =
    await Promise.all([
      client.query(
        `SELECT device_id,
                accepted_through_sequence::text,
                highest_sequence_seen::text,
                last_seen_at,
                last_cloud_delivery_at
         FROM edge_device_watermarks
         ORDER BY device_id`,
      ),
      client.query(
        `SELECT device_id,count(*)::text AS processed_count
         FROM edge_processed_device_events
         GROUP BY device_id
         ORDER BY device_id`,
      ),
      client.query(
        `SELECT device_id,
                count(*) FILTER (WHERE delivered_at IS NULL)::text AS pending_count,
                coalesce(max(attempts) FILTER (WHERE delivered_at IS NULL),0)::text AS max_pending_attempts
         FROM edge_cloud_outbox
         GROUP BY device_id
         ORDER BY device_id`,
      ),
      client.query(
        `SELECT device_id,count(*)::text AS unresolved_count
         FROM edge_reconciliation_exceptions
         WHERE resolved_at IS NULL
         GROUP BY device_id
         ORDER BY device_id NULLS FIRST`,
      ),
      client.query(
        `SELECT inventory_location_id,sku_id,on_hand::text
         FROM edge_inventory_stock_projection
         WHERE event_id=$1
         ORDER BY inventory_location_id,sku_id`,
        [eventId],
      ),
      client.query(
        `SELECT count(*)::text AS open_count
         FROM edge_stock_transfers
         WHERE event_id=$1 AND state NOT IN ('RECEIVED','CANCELLED')`,
        [eventId],
      ),
      client.query(
        `SELECT count(*)::text AS open_count
         FROM edge_stock_counts
         WHERE event_id=$1 AND state='OPEN'`,
        [eventId],
      ),
      client.query(
        `SELECT provider_id,status,count(*)::text AS attempt_count,
                coalesce(sum(amount_minor),0)::text AS value_minor
         FROM edge_payment_attempt_cache
         WHERE event_id=$1 AND status IN ('PENDING','UNKNOWN')
         GROUP BY provider_id,status
         ORDER BY provider_id,status`,
        [eventId],
      ),
    ]);

  const processedByDevice = mapBy(processed.rows, 'device_id');
  const backlogByDevice = mapBy(backlog.rows, 'device_id');
  const exceptionsByDevice = mapBy(
    exceptions.rows.filter((row) => row.device_id !== null),
    'device_id',
  );

  const devices = watermarks.rows.map((row) => {
    const deviceId = String(row.device_id);
    const processedRow = processedByDevice.get(deviceId);
    const backlogRow = backlogByDevice.get(deviceId);
    const exceptionRow = exceptionsByDevice.get(deviceId);
    return {
      deviceId,
      acceptedThroughSequence: asBigIntString(
        row.accepted_through_sequence,
        `${deviceId}.acceptedThroughSequence`,
      ),
      highestSequenceSeen: asBigIntString(
        row.highest_sequence_seen,
        `${deviceId}.highestSequenceSeen`,
      ),
      processedEventCount: asSafeInteger(
        processedRow?.processed_count ?? 0,
        `${deviceId}.processedEventCount`,
      ),
      cloudBacklogCount: asSafeInteger(
        backlogRow?.pending_count ?? 0,
        `${deviceId}.cloudBacklogCount`,
      ),
      maxPendingCloudDeliveryAttempts: asSafeInteger(
        backlogRow?.max_pending_attempts ?? 0,
        `${deviceId}.maxPendingCloudDeliveryAttempts`,
      ),
      unresolvedReconciliationExceptionCount: asSafeInteger(
        exceptionRow?.unresolved_count ?? 0,
        `${deviceId}.unresolvedReconciliationExceptionCount`,
      ),
      lastSeenAt: isoOrNull(row.last_seen_at),
      lastCloudDeliveryAt: isoOrNull(row.last_cloud_delivery_at),
    };
  });

  const processedForUnknownDevices = processed.rows
    .filter((row) => !watermarks.rows.some((watermark) => watermark.device_id === row.device_id))
    .reduce(
      (sum, row) => sum + asSafeInteger(row.processed_count, 'orphanProcessedEventCount'),
      0,
    );
  if (processedForUnknownDevices > 0) {
    throw new Error('processed device events exist without an Edge device watermark');
  }

  const unattributedReconciliationExceptionCount = exceptions.rows
    .filter((row) => row.device_id === null)
    .reduce(
      (sum, row) => sum + asSafeInteger(row.unresolved_count, 'unattributedExceptionCount'),
      0,
    );

  const inventory = stock.rows.map((row) => ({
    inventoryLocationId: String(row.inventory_location_id),
    skuId: String(row.sku_id),
    onHandBase: asBigIntString(row.on_hand, 'inventory.onHandBase'),
  }));

  const unresolvedPayments = payments.rows.map((row) => ({
    providerId: String(row.provider_id),
    status: String(row.status),
    attemptCount: asSafeInteger(row.attempt_count, 'payment.attemptCount'),
    valueMinor: asBigIntString(row.value_minor, 'payment.valueMinor'),
  }));

  const deviceReconciliationExceptionCount = devices.reduce(
    (sum, row) => sum + row.unresolvedReconciliationExceptionCount,
    0,
  );

  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    releaseCommit,
    edgeId,
    eventId,
    totals: {
      deviceCount: devices.length,
      processedEventCount: devices.reduce((sum, row) => sum + row.processedEventCount, 0),
      cloudBacklogCount: devices.reduce((sum, row) => sum + row.cloudBacklogCount, 0),
      unresolvedReconciliationExceptionCount:
        deviceReconciliationExceptionCount + unattributedReconciliationExceptionCount,
      unattributedReconciliationExceptionCount,
      openTransferCount: asSafeInteger(
        transfers.rows[0]?.open_count ?? 0,
        'openTransferCount',
      ),
      openStockCountCount: asSafeInteger(
        counts.rows[0]?.open_count ?? 0,
        'openStockCountCount',
      ),
      unresolvedPaymentAttemptCount: unresolvedPayments.reduce(
        (sum, row) => sum + row.attemptCount,
        0,
      ),
    },
    devices,
    inventory,
    unresolvedPayments,
    dataSafetyNotice:
      'Aggregate operational evidence only: no event payloads, payment identifiers, credentials or raw reconciliation details are included.',
  };
}

async function main() {
  const connectionString = required(process.env, 'EDGE_DATABASE_URL');
  const { Pool } = await import('pg');
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 3_000,
    idleTimeoutMillis: 1_000,
  });

  try {
    const report = await collectEdgeFieldDiagnostics(pool, process.env);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
