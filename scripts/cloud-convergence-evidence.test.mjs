import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyCloudConvergenceEvidence } from './cloud-convergence-evidence.mjs';

const releaseCommit = 'a'.repeat(40);
const eventId = 'event-1';

function order(orderId, sequence) {
  return {
    orderId,
    deviceId: 'device-1',
    lastSequence: String(sequence),
    state: 'CLOSED',
    totalMinor: '1000',
    currency: 'KES',
    salesLocationId: 'bar-1',
    closeMethod: 'CASH',
    cashierId: 'operator-1',
    lines: [{ skuId: 'sku-1', quantity: 1, unitPriceMinor: 1000 }],
  };
}

function snapshot({
  generatedAt,
  processedCount,
  closedCount,
  inventoryCount,
  unresolvedSyncExceptionCount = 0,
  unresolvedInventoryExceptionCount = 0,
}) {
  return {
    schemaVersion: 1,
    releaseCommit,
    eventId,
    generatedAt,
    unresolvedSyncExceptionCount,
    unresolvedInventoryExceptionCount,
    processedEvents: Array.from({ length: processedCount }, (_, index) => ({
      eventInstanceId: `event-instance-${index + 1}`,
      deviceId: 'device-1',
      sequence: String(index + 1),
      idempotencyKey: `sync-idem-${index + 1}`,
      eventType: index % 2 === 0 ? 'ORDER_OPENED' : 'ORDER_CLOSED_CASH',
      aggregateId: `order-${Math.floor(index / 2) + 1}`,
    })),
    orders: Array.from({ length: closedCount }, (_, index) =>
      order(`order-${index + 1}`, index + 1),
    ),
    inventoryEdgeEvents: Array.from({ length: inventoryCount }, (_, index) => ({
      id: `inventory-event-${index + 1}`,
      eventType: 'INVENTORY_LEDGER_POSTED',
      aggregateType: 'INVENTORY',
      aggregateId: `ledger-${index + 1}`,
    })),
    inventoryLedger: Array.from({ length: inventoryCount }, (_, index) => ({
      id: `ledger-${index + 1}`,
      inventoryLocationId: 'bar-stock',
      skuId: 'sku-1',
      movementType: 'SALE',
      quantityDeltaBase: '-1',
      idempotencyKey: `inventory-idem-${index + 1}`,
      edgeEventId: `inventory-event-${index + 1}`,
      sourceEventInstanceId: `event-instance-${index + 1}`,
    })),
    stockProjection:
      inventoryCount === 0
        ? []
        : [
            {
              inventoryLocationId: 'bar-stock',
              skuId: 'sku-1',
              onHandBase: String(1000 - inventoryCount),
            },
          ],
  };
}

function fixture() {
  const baseline = snapshot({
    generatedAt: '2026-08-25T10:00:00.000Z',
    processedCount: 2,
    closedCount: 1,
    inventoryCount: 1,
  });
  const firstDrain = snapshot({
    generatedAt: '2026-08-25T10:20:00.000Z',
    processedCount: 202,
    closedCount: 101,
    inventoryCount: 101,
  });
  const afterDuplicateReplay = structuredClone(firstDrain);
  afterDuplicateReplay.generatedAt = '2026-08-25T10:30:00.000Z';

  return {
    manifest: {
      schemaVersion: 1,
      releaseCommit,
      eventId,
      minimumNewClosedOrders: 100,
    },
    durabilityReport: {
      schemaVersion: 1,
      releaseCommit,
      eventId,
      status: 'PASS',
      aggregateNewClosedOrders: 100,
      gateBSatisfied: false,
    },
    baseline,
    firstDrain,
    afterDuplicateReplay,
  };
}

test('passes when durability is green and duplicate replay has zero Cloud business effect', () => {
  const report = verifyCloudConvergenceEvidence(fixture());
  assert.equal(report.status, 'PASS');
  assert.equal(report.gateBSatisfied, true);
  assert.equal(report.newCloudClosedOrders, 100);
  assert.equal(report.liveMoneyApproved, false);
  assert.equal(
    report.firstDrainBusinessDigestSha256,
    report.afterDuplicateReplayBusinessDigestSha256,
  );
});

test('fails when duplicate replay adds a processed event', () => {
  const input = fixture();
  input.afterDuplicateReplay.processedEvents.push({
    eventInstanceId: 'unexpected-replay-effect',
    deviceId: 'device-1',
    sequence: '999',
    idempotencyKey: 'unexpected-idem',
    eventType: 'ORDER_CLOSED_CASH',
    aggregateId: 'order-999',
  });
  const report = verifyCloudConvergenceEvidence(input);
  assert.equal(report.status, 'FAIL');
  assert.equal(report.gateBSatisfied, false);
  assert.equal(
    report.checks.find((entry) => entry.id === 'cloud:duplicate-replay:no-business-effect')?.status,
    'FAIL',
  );
});

test('fails when inventory stock changes during duplicate replay', () => {
  const input = fixture();
  input.afterDuplicateReplay.stockProjection[0].onHandBase = '898';
  const report = verifyCloudConvergenceEvidence(input);
  assert.equal(report.status, 'FAIL');
  assert.equal(
    report.checks.find((entry) => entry.id === 'cloud:duplicate-replay:no-business-effect')?.status,
    'FAIL',
  );
});

test('fails when Cloud closed-order delta does not equal the POS durability delta', () => {
  const input = fixture();
  input.firstDrain.orders.pop();
  input.afterDuplicateReplay = structuredClone(input.firstDrain);
  input.afterDuplicateReplay.generatedAt = '2026-08-25T10:30:00.000Z';
  const report = verifyCloudConvergenceEvidence(input);
  assert.equal(report.status, 'FAIL');
  assert.equal(
    report.checks.find((entry) => entry.id === 'cloud:first-drain:new-closed-orders-match-pos')
      ?.status,
    'FAIL',
  );
});

test('fails closed on unresolved reconciliation exceptions', () => {
  const input = fixture();
  input.firstDrain.unresolvedInventoryExceptionCount = 1;
  input.afterDuplicateReplay.unresolvedInventoryExceptionCount = 1;
  const report = verifyCloudConvergenceEvidence(input);
  assert.equal(report.status, 'FAIL');
  assert.equal(
    report.checks.find((entry) => entry.id === 'cloud:first-drain:inventory-reconciliation-clean')
      ?.status,
    'FAIL',
  );
});

test('fails closed on release mismatch', () => {
  const input = fixture();
  input.afterDuplicateReplay.releaseCommit = 'b'.repeat(40);
  const report = verifyCloudConvergenceEvidence(input);
  assert.equal(report.status, 'FAIL');
  assert.equal(
    report.checks.find((entry) => entry.id === 'cloud:afterDuplicateReplay:schema')?.status,
    'FAIL',
  );
});
