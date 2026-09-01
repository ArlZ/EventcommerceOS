import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import pg from 'pg';

const { Client } = pg;
const SHA_PATTERN = /^[0-9a-f]{40}$/;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function nonEmpty(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function safeCount(value, label) {
  if (!/^\d+$/.test(String(value))) throw new Error(`${label} is not a non-negative integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed))
    throw new Error(`${label} exceeds JavaScript safe integer range`);
  return parsed;
}

function usage() {
  console.error(
    'Usage: pnpm --filter @event-commerce/cloud-api cloud-convergence:snapshot -- <event-id> [output.json]',
  );
}

async function main() {
  const eventId = process.argv[2]?.trim();
  if (!eventId) {
    usage();
    process.exitCode = 2;
    return;
  }

  const releaseCommit = required('RELEASE_COMMIT');
  if (!SHA_PATTERN.test(releaseCommit)) {
    throw new Error('RELEASE_COMMIT must be a lowercase 40-character Git SHA');
  }
  const databaseUrl = required('DATABASE_URL');
  const outputPath = resolve(
    process.argv[3] ?? `artifacts/pilot/cloud-convergence-${Date.now()}.json`,
  );

  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: Number(process.env.PGCONNECT_TIMEOUT_MS ?? '10000'),
  });

  await client.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');

    const [
      processedEventsResult,
      ordersResult,
      inventoryEdgeEventsResult,
      inventoryLedgerResult,
      stockProjectionResult,
      unresolvedSyncResult,
      unresolvedInventoryResult,
    ] = await Promise.all([
      client.query(
        `SELECT event_instance_id AS "eventInstanceId",
                device_id AS "deviceId",
                sequence::text,
                idempotency_key AS "idempotencyKey",
                event_type AS "eventType",
                aggregate_id AS "aggregateId"
         FROM sync_processed_events
         WHERE payload ->> 'eventId' = $1
         ORDER BY device_id, sequence, event_instance_id`,
        [eventId],
      ),
      client.query(
        `SELECT order_id AS "orderId",
                device_id AS "deviceId",
                last_sequence::text AS "lastSequence",
                state,
                total_minor::text AS "totalMinor",
                currency,
                sales_location_id AS "salesLocationId",
                close_method AS "closeMethod",
                cashier_id AS "cashierId",
                lines
         FROM sync_order_state
         WHERE event_id = $1
         ORDER BY order_id`,
        [eventId],
      ),
      client.query(
        `SELECT id,
                event_type AS "eventType",
                aggregate_type AS "aggregateType",
                aggregate_id AS "aggregateId"
         FROM inventory_edge_events
         WHERE payload ->> 'eventId' = $1
         ORDER BY id`,
        [eventId],
      ),
      client.query(
        `SELECT id,
                inventory_location_id AS "inventoryLocationId",
                sku_id AS "skuId",
                movement_type AS "movementType",
                quantity_delta::text AS "quantityDeltaBase",
                idempotency_key AS "idempotencyKey",
                edge_event_id AS "edgeEventId",
                source_event_instance_id AS "sourceEventInstanceId"
         FROM inventory_ledger
         WHERE event_id = $1
         ORDER BY id`,
        [eventId],
      ),
      client.query(
        `SELECT inventory_location_id AS "inventoryLocationId",
                sku_id AS "skuId",
                on_hand::text AS "onHandBase"
         FROM inventory_stock_projection
         WHERE event_id = $1
         ORDER BY inventory_location_id, sku_id`,
        [eventId],
      ),
      client.query(
        `SELECT count(*)::text AS count
         FROM sync_reconciliation_exceptions
         WHERE resolved_at IS NULL`,
      ),
      client.query(
        `SELECT count(*)::text AS count
         FROM inventory_reconciliation_exceptions
         WHERE resolved_at IS NULL`,
      ),
    ]);

    const snapshot = {
      schemaVersion: 1,
      releaseCommit,
      eventId: nonEmpty(eventId, 'eventId'),
      generatedAt: new Date().toISOString(),
      unresolvedSyncExceptionCount: safeCount(
        unresolvedSyncResult.rows[0]?.count ?? '0',
        'unresolved sync exception count',
      ),
      unresolvedInventoryExceptionCount: safeCount(
        unresolvedInventoryResult.rows[0]?.count ?? '0',
        'unresolved inventory exception count',
      ),
      processedEvents: processedEventsResult.rows,
      orders: ordersResult.rows,
      inventoryEdgeEvents: inventoryEdgeEventsResult.rows,
      inventoryLedger: inventoryLedgerResult.rows,
      stockProjection: stockProjectionResult.rows,
    };

    await client.query('COMMIT');
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
    console.log(
      `Cloud convergence snapshot: ${outputPath} event=${eventId} orders=${snapshot.orders.length} processedEvents=${snapshot.processedEvents.length} inventoryLedger=${snapshot.inventoryLedger.length}`,
    );
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original snapshot failure.
    }
    throw error;
  } finally {
    await client.end();
  }
}

await main();
