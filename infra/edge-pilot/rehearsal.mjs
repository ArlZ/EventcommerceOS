import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const { Client } = pg;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveBigInt(name) {
  const value = required(name);
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n) {
    throw new Error(`${name} must be a positive integer`);
  }
  return BigInt(value);
}

function command(action, env) {
  const result = spawnSync(process.execPath, ['scripts/manage-pos-device.mjs', action], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`POS device ${action} failed${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout;
}

function tokenFromProvisioning(output) {
  const line = output
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith('DEVICE_EDGE_TOKEN='));
  const token = line?.slice('DEVICE_EDGE_TOKEN='.length).trim();
  if (!token || token.length < 32) throw new Error('POS device provisioning did not return a token');
  return token;
}

async function stockOnHand(client, eventId, inventoryLocationId, skuId) {
  const result = await client.query(
    `SELECT on_hand::text AS on_hand
     FROM edge_inventory_stock_projection
     WHERE event_id=$1 AND inventory_location_id=$2 AND sku_id=$3`,
    [eventId, inventoryLocationId, skuId],
  );
  if (result.rowCount !== 1) {
    throw new Error('Pilot stock projection is missing; run bootstrap before rehearsal');
  }
  return BigInt(result.rows[0].on_hand);
}

function rehearsalOccurredAt(openingAt, eventEndAt) {
  const openingMs = Date.parse(openingAt);
  const endMs = Date.parse(eventEndAt);
  if (Number.isNaN(openingMs) || Number.isNaN(endMs)) {
    throw new Error('Pilot timestamps must be valid ISO timestamps');
  }
  const occurredMs = openingMs + 5 * 60_000;
  if (occurredMs >= endMs) throw new Error('Pilot rehearsal timestamp must be before event end');
  return new Date(occurredMs).toISOString();
}

const databaseUrl = required('EDGE_DATABASE_URL');
const eventId = required('PILOT_EVENT_ID');
const salesLocationId = required('PILOT_SALES_LOCATION_ID');
const inventoryLocationId = required('PILOT_INVENTORY_LOCATION_ID');
const skuId = required('PILOT_SKU_ID');
const openingStock = positiveBigInt('PILOT_OPENING_STOCK_BASE');
const openingAt = required('PILOT_OPENING_STOCK_OCCURRED_AT');
const eventEndAt = required('PILOT_EVENT_END_AT');

const deviceId = `pilot-rehearsal-${randomUUID()}`;
const orderId = `pilot-rehearsal-order-${randomUUID()}`;
const eventInstanceId = `pilot-rehearsal-event-${randomUUID()}`;
const actor = 'edge-pilot-rehearsal';
const deviceEnv = {
  DEVICE_ID: deviceId,
  DEVICE_EVENT_ID: eventId,
  DEVICE_SALES_LOCATION_ID: salesLocationId,
  DEVICE_REGISTER_ID: deviceId,
  DEVICE_CREDENTIAL_ACTOR: actor,
};

const database = new Client({ connectionString: databaseUrl });
let provisioned = false;

try {
  await database.connect();
  const before = await stockOnHand(database, eventId, inventoryLocationId, skuId);
  if (before !== openingStock) {
    throw new Error(
      `One-sale rehearsal is fail-closed: expected untouched opening stock ${openingStock}, found ${before}`,
    );
  }

  const token = tokenFromProvisioning(command('provision', deviceEnv));
  provisioned = true;

  const envelope = {
    schemaVersion: 1,
    eventInstanceId,
    eventId: `event-${eventInstanceId}`,
    eventType: 'ORDER_CLOSED_CASH',
    aggregateType: 'ORDER',
    aggregateId: orderId,
    eventVersion: 2,
    deviceId,
    sequence: 1,
    occurredAt: rehearsalOccurredAt(openingAt, eventEndAt),
    idempotencyKey: `idem-${eventInstanceId}`,
    payload: {
      orderId,
      eventId,
      salesLocationId,
      state: 'CLOSED',
      totalMinor: 100,
      currency: 'KES',
      lines: [
        {
          menuItemId: `pilot-menu-${skuId}`,
          skuId,
          quantity: 1,
          unitPriceMinor: 100,
        },
      ],
    },
  };

  const response = await fetch('http://127.0.0.1:3002/sync/device-events', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-device-id': deviceId,
    },
    body: JSON.stringify({ deviceId, events: [envelope] }),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Synthetic POS sync failed with HTTP ${response.status}: ${text}`);
  }
  const acknowledgement = text ? JSON.parse(text) : {};
  const receipt = acknowledgement.receipts?.[0];
  if (!receipt || receipt.status !== 'ACCEPTED') {
    throw new Error(`Synthetic POS event was not accepted: ${JSON.stringify(receipt ?? null)}`);
  }

  const expectedAfter = openingStock - 1n;
  let after = await stockOnHand(database, eventId, inventoryLocationId, skuId);
  for (let attempt = 0; after !== expectedAfter && attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    after = await stockOnHand(database, eventId, inventoryLocationId, skuId);
  }
  if (after !== expectedAfter) {
    throw new Error(`Expected local stock ${expectedAfter} after one sale, found ${after}`);
  }

  command('revoke', deviceEnv);
  provisioned = false;

  console.log(
    JSON.stringify(
      {
        status: 'pass',
        eventId,
        deviceId,
        orderId,
        eventInstanceId,
        receiptStatus: receipt.status,
        acknowledgedThroughSequence: acknowledgement.acknowledgedThroughSequence ?? null,
        localStockBefore: before.toString(),
        localStockAfter: after.toString(),
        credentialRevoked: true,
      },
      null,
      2,
    ),
  );
} finally {
  if (provisioned) {
    try {
      command('revoke', deviceEnv);
    } catch {
      // Preserve the primary rehearsal failure; an operator can revoke the ephemeral device manually.
    }
  }
  await database.end().catch(() => undefined);
}
