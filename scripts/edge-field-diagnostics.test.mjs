import assert from 'node:assert/strict';
import test from 'node:test';
import { collectEdgeFieldDiagnostics } from '../infra/edge-pilot/field-diagnostics.mjs';

function fakeClient(overrides = {}) {
  return {
    async query(sql) {
      overrides.queries?.push(sql);
      if (sql.includes('FROM edge_pos_devices d')) {
        return {
          rows: overrides.watermarks ?? [
            {
              device_id: 'register-01',
              device_status: 'ACTIVE',
              watermark_present: true,
              accepted_through_sequence: '3',
              highest_sequence_seen: '6',
              last_seen_at: new Date('2026-08-25T09:00:00Z'),
              last_cloud_delivery_at: new Date('2026-08-25T08:59:00Z'),
            },
          ],
        };
      }
      if (sql.includes('FROM edge_processed_device_events') && !sql.includes('JOIN')) {
        return {
          rows: overrides.processed ?? [{ device_id: 'register-01', processed_count: '6' }],
        };
      }
      if (sql.includes('FROM edge_cloud_outbox')) {
        return {
          rows: overrides.backlog ?? [
            { device_id: 'register-01', pending_count: '3', max_pending_attempts: '2' },
          ],
        };
      }
      if (
        sql.includes('FROM edge_reconciliation_exceptions') &&
        sql.includes('device_id IS NULL')
      ) {
        return {
          rows: [
            {
              unresolved_count: String(overrides.hostGlobalUnattributedExceptions ?? 0),
            },
          ],
        };
      }
      if (sql.includes('FROM edge_reconciliation_exceptions')) {
        return {
          rows: overrides.exceptions ?? [{ device_id: 'register-01', unresolved_count: '1' }],
        };
      }
      if (sql.includes('FROM edge_inventory_stock_projection')) {
        return {
          rows: overrides.stock ?? [
            { inventory_location_id: 'store-01', sku_id: 'sku-01', on_hand: '98' },
          ],
        };
      }
      if (sql.includes('FROM edge_stock_transfers')) {
        return { rows: [{ open_count: '1' }] };
      }
      if (sql.includes('FROM edge_stock_counts')) {
        return { rows: [{ open_count: '0' }] };
      }
      if (sql.includes('FROM edge_payment_attempt_cache')) {
        return {
          rows: overrides.payments ?? [
            {
              provider_id: 'MPESA',
              status: 'PENDING',
              attempt_count: '1',
              value_minor: '100',
            },
          ],
        };
      }
      throw new Error(`unexpected diagnostic query: ${sql}`);
    },
  };
}

function allObjectKeys(value, output = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((entry) => allObjectKeys(entry, output));
    return output;
  }
  if (value === null || typeof value !== 'object') return output;

  for (const [key, nested] of Object.entries(value)) {
    output.add(key);
    allObjectKeys(nested, output);
  }
  return output;
}

const env = {
  RELEASE_COMMIT: 'a'.repeat(40),
  EDGE_ID: 'edge-01',
  PILOT_EVENT_ID: 'event-01',
};

test('edge field diagnostics reports event-scoped aggregate evidence', async () => {
  const report = await collectEdgeFieldDiagnostics(
    fakeClient(),
    env,
    new Date('2026-08-25T10:00:00Z'),
  );

  assert.equal(report.releaseCommit, 'a'.repeat(40));
  assert.equal(report.edgeId, 'edge-01');
  assert.equal(report.eventId, 'event-01');
  assert.deepEqual(report.totals, {
    deviceCount: 1,
    activeDeviceCount: 1,
    revokedDeviceCount: 0,
    processedEventCount: 6,
    cloudBacklogCount: 3,
    unresolvedReconciliationExceptionCount: 1,
    eventUnattributedReconciliationExceptionCount: 0,
    hostGlobalUnattributedReconciliationExceptionCount: 0,
    openTransferCount: 1,
    openStockCountCount: 0,
    unresolvedPaymentAttemptCount: 1,
  });
  assert.deepEqual(report.devices[0], {
    deviceId: 'register-01',
    deviceStatus: 'ACTIVE',
    watermarkPresent: true,
    acceptedThroughSequence: '3',
    highestSequenceSeen: '6',
    processedEventCount: 6,
    cloudBacklogCount: 3,
    maxPendingCloudDeliveryAttempts: 2,
    unresolvedReconciliationExceptionCount: 1,
    lastSeenAt: '2026-08-25T09:00:00.000Z',
    lastCloudDeliveryAt: '2026-08-25T08:59:00.000Z',
  });
  assert.deepEqual(report.inventory, [
    { inventoryLocationId: 'store-01', skuId: 'sku-01', onHandBase: '98' },
  ]);
  assert.deepEqual(report.unresolvedPayments, [
    { providerId: 'MPESA', status: 'PENDING', attemptCount: 1, valueMinor: '100' },
  ]);

  const keys = allObjectKeys(report);
  for (const forbiddenKey of [
    'payload',
    'envelope',
    'token',
    'providerReference',
    'paymentId',
    'orderId',
    'customer',
    'lastError',
    'details',
  ]) {
    assert.equal(
      keys.has(forbiddenKey),
      false,
      `forbidden evidence key ${forbiddenKey} is present`,
    );
  }
});

test('edge field diagnostics scopes by payload business event id', async () => {
  const queries = [];
  await collectEdgeFieldDiagnostics(fakeClient({ queries }), env);
  const businessEventScope = "payload ->> 'eventId'=$1";

  assert.equal(
    queries.filter((sql) => sql.includes(businessEventScope)).length >= 3,
    true,
  );
});

test('edge field diagnostics includes revoked pilot devices without losing their evidence', async () => {
  const report = await collectEdgeFieldDiagnostics(
    fakeClient({
      watermarks: [
        {
          device_id: 'register-retired',
          device_status: 'REVOKED',
          watermark_present: true,
          accepted_through_sequence: '9',
          highest_sequence_seen: '9',
          last_seen_at: null,
          last_cloud_delivery_at: null,
        },
      ],
      processed: [{ device_id: 'register-retired', processed_count: '9' }],
      backlog: [],
      exceptions: [],
      stock: [],
      payments: [],
    }),
    env,
  );

  assert.equal(report.totals.deviceCount, 1);
  assert.equal(report.totals.activeDeviceCount, 0);
  assert.equal(report.totals.revokedDeviceCount, 1);
  assert.equal(report.devices[0].deviceStatus, 'REVOKED');
});

test('edge field diagnostics keeps event-unattributed and host-global exceptions distinct', async () => {
  const report = await collectEdgeFieldDiagnostics(
    fakeClient({
      exceptions: [
        { device_id: null, unresolved_count: '2' },
        { device_id: 'register-01', unresolved_count: '1' },
      ],
      hostGlobalUnattributedExceptions: 4,
    }),
    env,
  );

  assert.equal(report.totals.unresolvedReconciliationExceptionCount, 3);
  assert.equal(report.totals.eventUnattributedReconciliationExceptionCount, 2);
  assert.equal(report.totals.hostGlobalUnattributedReconciliationExceptionCount, 4);
  assert.equal(report.devices[0].unresolvedReconciliationExceptionCount, 1);
});

test('edge field diagnostics fails closed if a registered device has events without a watermark', async () => {
  await assert.rejects(
    collectEdgeFieldDiagnostics(
      fakeClient({
        watermarks: [
          {
            device_id: 'register-01',
            device_status: 'ACTIVE',
            watermark_present: false,
            accepted_through_sequence: '0',
            highest_sequence_seen: '0',
            last_seen_at: null,
            last_cloud_delivery_at: null,
          },
        ],
      }),
      env,
    ),
    /has processed events without a device watermark/,
  );
});

test('edge field diagnostics fails closed if pilot events exist for an unregistered device', async () => {
  await assert.rejects(
    collectEdgeFieldDiagnostics(
      fakeClient({
        watermarks: [],
        processed: [{ device_id: 'register-orphan', processed_count: '1' }],
        backlog: [],
        exceptions: [],
        stock: [],
        payments: [],
      }),
      env,
    ),
    /pilot event has processed device events without a registered pilot device/,
  );
});
