import assert from 'node:assert/strict';
import test from 'node:test';
import { collectEdgeFieldDiagnostics } from '../infra/edge-pilot/field-diagnostics.mjs';

function fakeClient(overrides = {}) {
  return {
    async query(sql) {
      if (sql.includes('FROM edge_device_watermarks')) {
        return {
          rows: overrides.watermarks ?? [
            {
              device_id: 'register-01',
              accepted_through_sequence: '3',
              highest_sequence_seen: '6',
              last_seen_at: new Date('2026-08-25T09:00:00Z'),
              last_cloud_delivery_at: new Date('2026-08-25T08:59:00Z'),
            },
          ],
        };
      }
      if (sql.includes('FROM edge_processed_device_events')) {
        return { rows: overrides.processed ?? [{ device_id: 'register-01', processed_count: '6' }] };
      }
      if (sql.includes('FROM edge_cloud_outbox')) {
        return {
          rows: overrides.backlog ?? [
            { device_id: 'register-01', pending_count: '3', max_pending_attempts: '2' },
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
            { provider_id: 'MPESA', status: 'PENDING', attempt_count: '1', value_minor: '100' },
          ],
        };
      }
      throw new Error(`unexpected diagnostic query: ${sql}`);
    },
  };
}

const env = {
  RELEASE_COMMIT: 'a'.repeat(40),
  EDGE_ID: 'edge-01',
  PILOT_EVENT_ID: 'event-01',
};

test('edge field diagnostics reports aggregate sync, inventory and payment evidence', async () => {
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
    processedEventCount: 6,
    cloudBacklogCount: 3,
    unresolvedReconciliationExceptionCount: 1,
    openTransferCount: 1,
    openStockCountCount: 0,
    unresolvedPaymentAttemptCount: 1,
  });
  assert.deepEqual(report.devices[0], {
    deviceId: 'register-01',
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
  assert.equal(JSON.stringify(report).includes('payload'), false);
  assert.equal(JSON.stringify(report).includes('token'), false);
  assert.equal(JSON.stringify(report).includes('providerReference'), false);
});

test('edge field diagnostics fails closed if processed events lack a device watermark', async () => {
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
    /processed device events exist without an Edge device watermark/,
  );
});
