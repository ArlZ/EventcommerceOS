import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { collectEventCloseEvidence, verifyEventCloseEvidence } from './event-close-evidence.mjs';

const RELEASE = 'a'.repeat(40);
const EVENT_ID = '11111111-1111-4111-8111-111111111111';

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function liveReport() {
  return {
    event: {
      eventId: EVENT_ID,
      organisationId: '22222222-2222-4222-8222-222222222222',
      name: 'Pilot Event',
      timezone: 'Africa/Nairobi',
      lifecycle: 'ACTIVE',
    },
    close: {
      state: 'OPERATIONALLY_CLOSED',
      lastActionAt: '2026-08-25T20:00:00.000Z',
      lastClosedAt: '2026-08-25T20:00:00.000Z',
      lastClosedRevision: 1,
      lastClosedReportId: 'report-1',
      sourceVersionAtLastClose: 'source-token-1',
      sourceChangedSinceLastClose: false,
    },
    generatedAt: '2026-08-25T20:00:01.000Z',
    sourceVersionToken: 'source-token-1',
    sales: {
      grossSales: [{ currency: 'KES', amountMinor: '10000' }],
      discounts: [{ currency: 'KES', amountMinor: '0' }],
      comps: [{ currency: 'KES', amountMinor: '0' }],
      voids: [{ currency: 'KES', amountMinor: '0' }],
      refunds: [{ currency: 'KES', amountMinor: '0' }],
      netSales: [{ currency: 'KES', amountMinor: '10000' }],
    },
    paymentMethods: [
      {
        methodId: 'cash',
        currency: 'KES',
        succeededCount: 1,
        grossTenderMinor: '10000',
        refundMinor: '0',
        reversalMinor: '0',
        netTenderMinor: '10000',
        unresolvedAttemptCount: 0,
      },
    ],
    providerReconciliation: [],
    cash: {
      summary: [
        {
          currency: 'KES',
          expectedMinor: '10000',
          declaredMinor: '10000',
          varianceMinor: '0',
          declarationStatus: 'COMPLETE',
        },
      ],
      scopes: [
        {
          salesLocationId: 'loc-1',
          salesLocationName: 'Main Bar',
          deviceId: 'device-1',
          cashierId: 'cashier-1',
          currency: 'KES',
          expectedMinor: '10000',
          declaredMinor: '10000',
          varianceMinor: '0',
          declarationStatus: 'DECLARED',
          declarationId: 'decl-1',
          declaredAt: '2026-08-25T19:59:00.000Z',
        },
      ],
    },
    inventoryVariances: [
      {
        inventoryLocationId: 'store-1',
        inventoryLocationName: 'Main Store',
        skuId: 'sku-1',
        skuName: 'Water',
        expectedQuantityBase: '10',
        physicalQuantityBase: '10',
        varianceQuantityBase: '0',
        unitCostMinor: null,
        valuationCurrency: null,
        varianceValueMinor: null,
        valuationStatus: 'MISSING_UNIT_COST',
        countId: 'count-1',
        countClosedAt: '2026-08-25T19:58:00.000Z',
      },
    ],
    unresolvedPayments: [],
    openTransfers: [],
    unresolvedCriticalAlerts: [],
    drilldowns: [
      {
        dimensionType: 'DEVICE',
        dimensionId: 'device-1',
        dimensionName: null,
        currency: 'KES',
        transactionCount: 1,
        grossSalesMinor: '10000',
        discountMinor: '0',
        compMinor: '0',
        voidMinor: '0',
        refundMinor: '0',
        netSalesMinor: '10000',
      },
    ],
    financialReconciliation: [
      {
        currency: 'KES',
        netSalesMinor: '10000',
        electronicNetTenderMinor: '0',
        cashExpectedMinor: '10000',
        accountedTenderMinor: '10000',
        salesToTenderVarianceMinor: '0',
        conclusive: true,
      },
    ],
  };
}

function bundle() {
  const report = liveReport();
  const stored = structuredClone(report);
  stored.generatedAt = '2026-08-25T20:00:00.000Z';
  const storedView = {
    reportId: 'report-1',
    eventId: EVENT_ID,
    revision: 1,
    sourceVersionToken: 'source-token-1',
    sha256: digest(JSON.stringify(stored)),
    createdByActorId: 'actor-1',
    createdAt: '2026-08-25T20:00:00.000Z',
    report: stored,
  };
  return {
    schemaVersion: 1,
    releaseCommit: RELEASE,
    collectedAt: '2026-08-25T20:01:00.000Z',
    eventId: EVENT_ID,
    runtimeHealth: {
      service: 'cloud-api',
      status: 'ok',
      releaseCommit: RELEASE,
    },
    liveReport: report,
    actions: [
      {
        actionId: 'action-1',
        eventId: EVENT_ID,
        action: 'OPERATIONALLY_CLOSE',
        actorId: 'actor-1',
        reason: 'pilot close',
        reportId: 'report-1',
        closeRevision: 1,
        createdAt: '2026-08-25T20:00:00.000Z',
      },
    ],
    storedReports: [storedView],
    latestStoredCsv: {
      revision: 1,
      sha256: digest('csv-data\n'),
      byteLength: 9,
    },
  };
}

test('passes a clean exact-release close with resolved finance and inventory', () => {
  const report = verifyEventCloseEvidence(bundle(), RELEASE, new Date('2026-08-25T20:02:00Z'));
  assert.equal(report.controlledPilotCloseSatisfied, true);
  assert.equal(report.inventoryCloseReconciliationSatisfied, true);
  assert.equal(report.liveMoneyApproved, false);
  assert.equal(report.checks.every((item) => item.status === 'PASS'), true);
});

test('fails closed when a stored report no longer matches its immutable SHA-256', () => {
  const evidence = bundle();
  evidence.storedReports[0].report.sales.netSales[0].amountMinor = '9999';
  const report = verifyEventCloseEvidence(evidence, RELEASE);
  assert.equal(report.controlledPilotCloseSatisfied, false);
  assert.equal(
    report.checks.find((item) => item.id === 'close:stored-report-hashes').status,
    'FAIL',
  );
});

test('fails when source truth changed after the stored close', () => {
  const evidence = bundle();
  evidence.liveReport.close.sourceChangedSinceLastClose = true;
  evidence.liveReport.sourceVersionToken = 'source-token-2';
  const report = verifyEventCloseEvidence(evidence, RELEASE);
  assert.equal(report.controlledPilotCloseSatisfied, false);
  assert.equal(report.checks.find((item) => item.id === 'close:source-stable').status, 'FAIL');
  assert.equal(
    report.checks.find((item) => item.id === 'close:latest-live-alignment').status,
    'FAIL',
  );
});

test('fails on unresolved provider/payment truth', () => {
  const evidence = bundle();
  evidence.liveReport.unresolvedPayments.push({
    paymentAttemptId: 'attempt-1',
    orderId: 'order-1',
    status: 'UNKNOWN',
  });
  evidence.liveReport.providerReconciliation.push({
    providerId: 'mpesa',
    currency: 'KES',
    pendingCount: 0,
    unknownCount: 1,
    adjustmentUnknownCount: 0,
    transactionReconciliationStatus: 'UNRESOLVED',
  });
  const report = verifyEventCloseEvidence(evidence, RELEASE);
  assert.equal(report.controlledPilotCloseSatisfied, false);
  assert.equal(
    report.checks.find((item) => item.id === 'payments:unresolved-attempts').status,
    'FAIL',
  );
  assert.equal(
    report.checks.find((item) => item.id === 'payments:provider-reconciliation').status,
    'FAIL',
  );
});

test('fails on sales-to-tender variance and missing cash declaration', () => {
  const evidence = bundle();
  evidence.liveReport.financialReconciliation[0].salesToTenderVarianceMinor = '100';
  evidence.liveReport.cash.scopes[0].declarationStatus = 'MISSING';
  evidence.liveReport.cash.scopes[0].declaredMinor = null;
  evidence.liveReport.cash.scopes[0].varianceMinor = null;
  const report = verifyEventCloseEvidence(evidence, RELEASE);
  assert.equal(report.controlledPilotCloseSatisfied, false);
  assert.equal(
    report.checks.find((item) => item.id === 'financial:sales-to-tender').status,
    'FAIL',
  );
  assert.equal(
    report.checks.find((item) => item.id === 'cash:scope-declarations').status,
    'FAIL',
  );
});

test('fails inventory gate on open transfer, critical alert, or unvalued non-zero variance', () => {
  const evidence = bundle();
  evidence.liveReport.openTransfers.push({ transferId: 'transfer-1' });
  evidence.liveReport.unresolvedCriticalAlerts.push({ alertId: 'alert-1' });
  const variance = evidence.liveReport.inventoryVariances[0];
  variance.physicalQuantityBase = '9';
  variance.varianceQuantityBase = '-1';
  const report = verifyEventCloseEvidence(evidence, RELEASE);
  assert.equal(report.inventoryCloseReconciliationSatisfied, false);
  assert.equal(
    report.checks.find((item) => item.id === 'inventory:open-transfers').status,
    'FAIL',
  );
  assert.equal(
    report.checks.find((item) => item.id === 'inventory:critical-alerts').status,
    'FAIL',
  );
  assert.equal(
    report.checks.find((item) => item.id === 'inventory:variance-valuation').status,
    'FAIL',
  );
});

test('fails on exact-release mismatch', () => {
  const report = verifyEventCloseEvidence(bundle(), 'b'.repeat(40));
  assert.equal(report.controlledPilotCloseSatisfied, false);
  assert.equal(report.checks.find((item) => item.id === 'release:bundle').status, 'FAIL');
  assert.equal(report.checks.find((item) => item.id === 'release:cloud-health').status, 'FAIL');
});

test('fails when revision/action history does not identify the latest immutable close', () => {
  const evidence = bundle();
  evidence.actions[0].closeRevision = 2;
  evidence.latestStoredCsv.revision = 2;
  const report = verifyEventCloseEvidence(evidence, RELEASE);
  assert.equal(report.controlledPilotCloseSatisfied, false);
  assert.equal(report.checks.find((item) => item.id === 'close:latest-action').status, 'FAIL');
  assert.equal(report.checks.find((item) => item.id === 'close:csv-export').status, 'FAIL');
});

test('collector never serializes the operator bearer and binds to health release', async () => {
  const evidence = bundle();
  const responses = new Map([
    ['https://api.example.test/health', evidence.runtimeHealth],
    [`https://api.example.test/event-close/events/${EVENT_ID}/report`, evidence.liveReport],
    [`https://api.example.test/event-close/events/${EVENT_ID}/actions`, evidence.actions],
    [`https://api.example.test/event-close/events/${EVENT_ID}/reports`, evidence.storedReports],
  ]);
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/export.csv')) {
      return new Response('csv-data\n', { status: 200 });
    }
    return new Response(JSON.stringify(responses.get(url)), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const collected = await collectEventCloseEvidence({
    baseUrl: 'https://api.example.test',
    eventId: EVENT_ID,
    operatorBearer: 'top-secret-bearer',
    expectedReleaseCommit: RELEASE,
    fetchImpl,
    now: new Date('2026-08-25T20:03:00Z'),
  });
  assert.equal(collected.releaseCommit, RELEASE);
  assert.equal(JSON.stringify(collected).includes('top-secret-bearer'), false);
  assert.equal(
    calls.some((call) => call.options.headers.Authorization === 'Bearer top-secret-bearer'),
    true,
  );
});
