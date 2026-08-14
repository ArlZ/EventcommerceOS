import { describe, expect, it } from 'vitest';
import { evaluateReleaseGate } from '../src/release-gate';
import { runReleaseGateScenarios } from '../src/event-simulation-scenarios';

const results = runReleaseGateScenarios();
const byName = new Map(
  results.map((result) => [result.metrics.scenarioName, result]),
);

function scenario(name: string) {
  const result = byName.get(name);
  if (!result) throw new Error(`missing scenario ${name}`);
  return result;
}

describe('production hardening event simulator', () => {
  it('covers every Task 010 required failure mode', () => {
    expect([...byName.keys()].sort()).toEqual(
      [
        'cloud-outage-ordering-continues',
        'edge-cloud-partition-and-convergence',
        'isolated-pos-reconnects',
        'edge-restart-with-durable-backlog',
        'large-replay-is-idempotent',
        'payment-callback-delay-duplicate-reorder',
        'popular-product-demand-spike',
        'sales-with-replenishment-transfer',
        'notification-outage-is-non-blocking',
        'slow-edge-cloud-dependency-recovers',
        'wan-failover-at-application-boundary',
      ].sort(),
    );
  });

  it('passes automated invariants while refusing to substitute simulation for a live pilot', () => {
    const evaluation = evaluateReleaseGate(results);
    expect(evaluation.automatedInvariantPass).toBe(true);
    expect(evaluation.hardFailures).toEqual([]);
    expect(evaluation.pilotEvidenceRequired.length).toBeGreaterThan(0);

    for (const result of results) {
      expect(result.metrics.evidenceKind).toBe('DETERMINISTIC_MODEL');
      expect(result.metrics.committedOrderDurability).toBe(1);
      expect(result.metrics.cloudOrders).toBe(result.metrics.generatedOrders);
      expect(result.metrics.finalSyncBacklog).toBe(0);
      expect(result.metrics.duplicateBusinessEffects).toBe(0);
      expect(result.metrics.falsePaymentFailures).toBe(0);
      expect(result.metrics.inventoryConverged).toBe(true);
      expect(result.metrics.dashboardLagFinalMs).toBe(0);
      expect(result.metrics.modeledLocalCommitLatencyP95Ms).toBeLessThanOrEqual(
        250,
      );
    }
  });

  it('measures real recovery drain after long partitions, isolation, restart and degradation', () => {
    for (const name of [
      'cloud-outage-ordering-continues',
      'edge-cloud-partition-and-convergence',
      'isolated-pos-reconnects',
      'edge-restart-with-durable-backlog',
      'large-replay-is-idempotent',
      'slow-edge-cloud-dependency-recovers',
      'wan-failover-at-application-boundary',
    ]) {
      const metrics = scenario(name).metrics;
      expect(metrics.maxSyncBacklog).toBeGreaterThan(0);
      expect(metrics.syncBacklogDrainMs).not.toBeNull();
      expect(metrics.syncBacklogDrainMs ?? 0).toBeGreaterThan(0);
    }
  });

  it('ignores a large duplicate replay without duplicating money or stock effects', () => {
    const metrics = scenario('large-replay-is-idempotent').metrics;
    expect(metrics.duplicateDeliveriesIgnored).toBeGreaterThan(1_000);
    expect(metrics.duplicateBusinessEffects).toBe(0);
    expect(metrics.inventoryConverged).toBe(true);
  });

  it('keeps delayed payment truth UNKNOWN, accepts duplicate callbacks once and later resolves', () => {
    const metrics = scenario('payment-callback-delay-duplicate-reorder').metrics;
    expect(metrics.paymentUnknownPeak).toBeGreaterThan(0);
    expect(metrics.providerCallbackDuplicatesIgnored).toBeGreaterThan(0);
    expect(metrics.paymentUnknownFinal).toBe(0);
    expect(metrics.falsePaymentFailures).toBe(0);
  });

  it('models a concentrated demand spike and a concurrent transfer without breaking convergence', () => {
    const spike = scenario('popular-product-demand-spike').metrics;
    expect(spike.ordersBySku['beer-500'] ?? 0).toBeGreaterThan(1_400);

    const transfer = scenario('sales-with-replenishment-transfer').metrics;
    expect(transfer.transferBusinessEffects).toBe(1);
    expect(transfer.inventoryConverged).toBe(true);
  });

  it('keeps notification-provider failure outside the commerce durability path', () => {
    const metrics = scenario('notification-outage-is-non-blocking').metrics;
    expect(metrics.notificationFailures).toBeGreaterThan(0);
    expect(metrics.durableLocalOrders).toBe(metrics.generatedOrders);
    expect(metrics.cloudOrders).toBe(metrics.generatedOrders);
    expect(metrics.inventoryConverged).toBe(true);
  });
});
