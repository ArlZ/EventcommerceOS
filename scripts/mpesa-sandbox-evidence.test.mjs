import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MPESA_SCENARIO_IDS,
  verifyMpesaSandboxFaultMatrix,
} from './mpesa-sandbox-evidence.mjs';

const releaseCommit = 'a'.repeat(40);

function scenario(id) {
  const base = {
    id,
    status: 'PASS',
    startedAt: '2026-08-27T08:00:00+03:00',
    completedAt: '2026-08-27T08:02:00+03:00',
    attemptId: `attempt-${id}`,
    evidence: { duplicateBusinessEffectCount: 0 },
  };
  if (id === 'MPESA-01') {
    base.evidence = {
      ...base.evidence,
      finalState: 'SUCCEEDED',
      paymentAttemptCount: 1,
      reconciliationOutstanding: false,
    };
  } else if (id === 'MPESA-02') {
    base.evidence = {
      ...base.evidence,
      finalState: 'FAILED',
      truthSource: 'PROVIDER_QUERY',
    };
  } else if (id === 'MPESA-03') {
    base.evidence = {
      ...base.evidence,
      initiationTransportUncertaintyObserved: true,
      uncertainStateObserved: 'UNKNOWN',
      paymentAttemptCount: 1,
    };
  } else if (id === 'MPESA-04') {
    base.evidence = {
      ...base.evidence,
      queryTransportFailureObserved: true,
      uncertainStateObserved: 'UNKNOWN',
    };
  } else if (id === 'MPESA-05') {
    base.evidence = {
      ...base.evidence,
      replayedSameIdempotencyKey: true,
      paymentAttemptCount: 1,
      providerInitiationCount: 1,
    };
  } else if (id === 'MPESA-06') {
    base.evidence = {
      ...base.evidence,
      duplicateCallbackCount: 1,
      duplicateDeliveryClassified: true,
    };
  } else if (id === 'MPESA-07') {
    base.evidence = {
      ...base.evidence,
      callbackBeforeQueryObserved: true,
      queryBeforeCallbackObserved: true,
      terminalStateRegressed: false,
      finalState: 'SUCCEEDED',
    };
  } else if (id === 'MPESA-08') {
    base.evidence = {
      ...base.evidence,
      malformedCallbackRejected: true,
      financialTruthChanged: false,
    };
  }
  return base;
}

function passingMatrix() {
  return {
    schemaVersion: 1,
    releaseCommit,
    eventId: 'event-controlled-pilot',
    provider: 'mpesa',
    environment: 'sandbox',
    liveMoneyApproved: false,
    operator: 'Sandbox Test Operator',
    scenarios: MPESA_SCENARIO_IDS.map(scenario),
  };
}

test('M-PESA sandbox verifier passes only a complete safe matrix', () => {
  const report = verifyMpesaSandboxFaultMatrix(
    passingMatrix(),
    new Date('2026-08-27T08:10:00+03:00'),
  );
  assert.equal(report.status, 'PASS');
  assert.equal(report.paymentFaultMatrixSatisfied, true);
  assert.equal(report.liveMoneyApproved, false);
  assert.match(report.reportDigestSha256, /^[0-9a-f]{64}$/);
  assert.equal(report.scenarioSummary.length, 8);
});

test('M-PESA sandbox verifier fails closed when one scenario is not run', () => {
  const matrix = passingMatrix();
  matrix.scenarios[3].status = 'NOT_RUN';
  const report = verifyMpesaSandboxFaultMatrix(matrix);
  assert.equal(report.status, 'FAIL');
  assert.equal(report.paymentFaultMatrixSatisfied, false);
  assert.equal(
    report.checks.find((entry) => entry.id === 'scenario:MPESA-04')?.status,
    'FAIL',
  );
});

test('M-PESA sandbox verifier rejects duplicate business effects', () => {
  const matrix = passingMatrix();
  matrix.scenarios[5].evidence.duplicateBusinessEffectCount = 1;
  const report = verifyMpesaSandboxFaultMatrix(matrix);
  assert.equal(report.status, 'FAIL');
  assert.match(
    report.checks.find((entry) => entry.id === 'scenario:MPESA-06')?.details ?? '',
    /duplicateBusinessEffectCount=0/,
  );
});

test('M-PESA sandbox verifier rejects phone and credential fields from retained evidence', () => {
  const matrix = passingMatrix();
  matrix.scenarios[0].evidence.msisdn = 'opaque-even-this-must-not-be-retained';
  const report = verifyMpesaSandboxFaultMatrix(matrix);
  assert.equal(report.status, 'FAIL');
  const hygiene = report.checks.find((entry) => entry.id === 'secret-and-phone-hygiene');
  assert.equal(hygiene?.status, 'FAIL');
  assert.match(hygiene?.details ?? '', /msisdn/);
});

test('M-PESA sandbox verifier never treats production or live money as valid evidence', () => {
  const matrix = passingMatrix();
  matrix.environment = 'production';
  matrix.liveMoneyApproved = true;
  const report = verifyMpesaSandboxFaultMatrix(matrix);
  assert.equal(report.status, 'FAIL');
  assert.equal(report.liveMoneyApproved, false);
  assert.equal(report.checks.find((entry) => entry.id === 'environment')?.status, 'FAIL');
  assert.equal(report.checks.find((entry) => entry.id === 'live-money-boundary')?.status, 'FAIL');
});
