import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyDurabilityEvidence } from './durability-evidence.mjs';

const releaseCommit = 'a'.repeat(40);

function pos({
  at,
  deviceId = 'register-01',
  closed,
  sequence,
  acknowledged,
  pending,
  edgeBacklog = 0,
  hasSyncError = false,
}) {
  return {
    schemaVersion: 1,
    generatedAtEpochMs: at,
    releaseCommit,
    appVersionName: '0.1.0',
    appVersionCode: 1,
    deviceId,
    activeMenuVersion: 1,
    closedOrderCount: closed,
    highestLocalSequence: sequence,
    acknowledgedThroughSequence: acknowledged,
    pendingAfterAcknowledgement: pending,
    edgeBacklogCount: edgeBacklog,
    lastSyncSuccessAtEpochMs: at,
    hasSyncError,
  };
}

function fixture() {
  return {
    manifest: {
      schemaVersion: 1,
      releaseCommit,
      eventId: 'event-01',
      minimumNewClosedOrders: 100,
      registers: [{ assetId: 'POS-01' }],
    },
    posSnapshots: {
      'POS-01': {
        baseline: pos({ at: 1, closed: 5, sequence: 10, acknowledged: 10, pending: 0 }),
        offline: pos({ at: 2, closed: 105, sequence: 210, acknowledged: 10, pending: 200 }),
        afterRestart: pos({ at: 3, closed: 105, sequence: 210, acknowledged: 10, pending: 200 }),
        final: pos({ at: 4, closed: 105, sequence: 210, acknowledged: 210, pending: 0 }),
      },
    },
    edgeFinal: {
      schemaVersion: 1,
      releaseCommit,
      eventId: 'event-01',
      edgeId: 'edge-01',
      totals: {
        cloudBacklogCount: 0,
        unresolvedReconciliationExceptionCount: 0,
        hostGlobalUnattributedReconciliationExceptionCount: 0,
      },
      devices: [
        {
          deviceId: 'register-01',
          acceptedThroughSequence: '210',
          highestSequenceSeen: '210',
        },
      ],
    },
  };
}

test('passes local durability and POS-to-Edge convergence without overstating Gate B', () => {
  const evidence = fixture();
  const report = verifyDurabilityEvidence({
    ...evidence,
    now: new Date('2026-08-25T11:00:00Z'),
  });

  assert.equal(report.status, 'PASS');
  assert.equal(report.aggregateNewClosedOrders, 100);
  assert.equal(report.gateBSatisfied, false);
  assert.match(report.remainingGateBProof, /duplicate replay/);
  assert.match(report.reportDigestSha256, /^[0-9a-f]{64}$/);
  assert.ok(report.checks.every((entry) => entry.status === 'PASS'));
});

test('fails when restart loses a committed order', () => {
  const evidence = fixture();
  evidence.posSnapshots['POS-01'].afterRestart.closedOrderCount = 104;

  const report = verifyDurabilityEvidence(evidence);
  assert.equal(report.status, 'FAIL');
  assert.equal(
    report.checks.find((entry) => entry.id === 'pos:POS-01:restart-preserves-orders')?.status,
    'FAIL',
  );
});

test('fails when restart loses durable sequence state', () => {
  const evidence = fixture();
  evidence.posSnapshots['POS-01'].afterRestart.highestLocalSequence = 209;

  const report = verifyDurabilityEvidence(evidence);
  assert.equal(report.status, 'FAIL');
  assert.equal(
    report.checks.find((entry) => entry.id === 'pos:POS-01:restart-preserves-sequence')?.status,
    'FAIL',
  );
});

test('fails when aggregate representative offline orders are below 100', () => {
  const evidence = fixture();
  evidence.posSnapshots['POS-01'].offline.closedOrderCount = 104;
  evidence.posSnapshots['POS-01'].afterRestart.closedOrderCount = 104;
  evidence.posSnapshots['POS-01'].final.closedOrderCount = 104;

  const report = verifyDurabilityEvidence(evidence);
  assert.equal(report.status, 'FAIL');
  assert.equal(
    report.checks.find((entry) => entry.id === 'pos:aggregate-minimum-orders')?.status,
    'FAIL',
  );
});

test('fails when final POS acknowledgement does not reach durable local sequence', () => {
  const evidence = fixture();
  evidence.posSnapshots['POS-01'].final.acknowledgedThroughSequence = 209;
  evidence.posSnapshots['POS-01'].final.pendingAfterAcknowledgement = 1;

  const report = verifyDurabilityEvidence(evidence);
  assert.equal(report.status, 'FAIL');
  assert.equal(
    report.checks.find((entry) => entry.id === 'pos:POS-01:final-acknowledgement')?.status,
    'FAIL',
  );
});

test('fails when Event Edge watermark does not match final POS sequence', () => {
  const evidence = fixture();
  evidence.edgeFinal.devices[0].acceptedThroughSequence = '209';

  const report = verifyDurabilityEvidence(evidence);
  assert.equal(report.status, 'FAIL');
  assert.equal(
    report.checks.find((entry) => entry.id === 'edge:POS-01:accepted-through')?.status,
    'FAIL',
  );
});

test('fails on unresolved event or host-global reconciliation state', () => {
  const evidence = fixture();
  evidence.edgeFinal.totals.unresolvedReconciliationExceptionCount = 1;
  evidence.edgeFinal.totals.hostGlobalUnattributedReconciliationExceptionCount = 2;

  const report = verifyDurabilityEvidence(evidence);
  assert.equal(report.status, 'FAIL');
  assert.equal(
    report.checks.find((entry) => entry.id === 'edge:event-reconciliation-clean')?.status,
    'FAIL',
  );
  assert.equal(
    report.checks.find((entry) => entry.id === 'edge:host-global-reconciliation-clean')?.status,
    'FAIL',
  );
});

test('supports LAN-only drills where POS-local pending state is explicitly not required', () => {
  const evidence = fixture();
  evidence.manifest.registers[0].requirePendingOffline = false;
  evidence.posSnapshots['POS-01'].offline.acknowledgedThroughSequence = 210;
  evidence.posSnapshots['POS-01'].offline.pendingAfterAcknowledgement = 0;
  evidence.posSnapshots['POS-01'].afterRestart.acknowledgedThroughSequence = 210;
  evidence.posSnapshots['POS-01'].afterRestart.pendingAfterAcknowledgement = 0;

  const report = verifyDurabilityEvidence(evidence);
  assert.equal(report.status, 'PASS');
});

test('fails closed when release identity changes between checkpoints', () => {
  const evidence = fixture();
  evidence.posSnapshots['POS-01'].afterRestart.releaseCommit = 'b'.repeat(40);

  const report = verifyDurabilityEvidence(evidence);
  assert.equal(report.status, 'FAIL');
  assert.equal(
    report.checks.find((entry) => entry.id === 'pos:POS-01:afterRestart:schema')?.status,
    'FAIL',
  );
});
