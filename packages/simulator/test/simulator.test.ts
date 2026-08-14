import { describe, expect, it } from 'vitest';
import { EventSimulation, requiredScenarios, runRequiredSuite } from '../src';

describe('event simulation release evidence', () => {
  it('is deterministic for the same scenario seed', () => {
    const config = requiredScenarios()[0];
    expect(config).toBeDefined();
    const first = new EventSimulation(config!).run();
    const second = new EventSimulation(config!).run();
    expect(second.metrics).toEqual(first.metrics);
    expect(second.assertions).toEqual(first.assertions);
  });

  it('covers every Task 010 required scenario family', () => {
    const names = requiredScenarios().map((scenario) => scenario.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'cloud-outage-local-commerce-continues',
        'edge-cloud-partition-and-drain',
        'single-pos-isolated-then-reconnects',
        'edge-restart-under-backlog',
        'large-sync-replay-duplicate-and-reorder',
        'payment-callback-delay-duplicate-reorder',
        'sudden-popular-product-demand-spike',
        'concurrent-sales-and-replenishment-transfers',
        'notification-provider-outage',
        'slow-cloud-database-under-load',
        'application-level-wan-failover',
        'combined-peak-above-pilot-target',
      ]),
    );
  });

  it('preserves local durability during a cloud outage and drains backlog later', () => {
    const config = requiredScenarios().find(
      (scenario) => scenario.name === 'cloud-outage-local-commerce-continues',
    );
    expect(config).toBeDefined();
    const result = new EventSimulation(config!).run();
    expect(result.metrics.committedOrders).toBeGreaterThan(0);
    expect(result.metrics.maxSyncBacklog).toBeGreaterThan(0);
    expect(result.metrics.lostCommittedOrders).toBe(0);
    expect(result.metrics.syncBacklogAtEnd).toBe(0);
    expect(result.metrics.edgeCloudConverged).toBe(true);
  });

  it('deduplicates replayed sync and provider signals', () => {
    const replay = requiredScenarios().find(
      (scenario) => scenario.name === 'large-sync-replay-duplicate-and-reorder',
    );
    const callbacks = requiredScenarios().find(
      (scenario) => scenario.name === 'payment-callback-delay-duplicate-reorder',
    );
    expect(replay).toBeDefined();
    expect(callbacks).toBeDefined();
    const replayResult = new EventSimulation(replay!).run();
    const callbackResult = new EventSimulation(callbacks!).run();
    expect(replayResult.metrics.duplicateSyncDeliveries).toBeGreaterThan(0);
    expect(callbackResult.metrics.duplicateProviderSignals).toBeGreaterThan(0);
    expect(replayResult.metrics.duplicateBusinessEffects).toBe(0);
    expect(callbackResult.metrics.duplicateBusinessEffects).toBe(0);
  });

  it('converges inventory after concurrent sales and replenishment', () => {
    const config = requiredScenarios().find(
      (scenario) => scenario.name === 'concurrent-sales-and-replenishment-transfers',
    );
    expect(config).toBeDefined();
    const result = new EventSimulation(config!).run();
    expect(result.metrics.transfersCreated).toBeGreaterThan(0);
    expect(result.metrics.transfersCompleted).toBe(result.metrics.transfersCreated);
    expect(result.metrics.inventoryConverged).toBe(true);
  });

  it('keeps payment uncertainty explicit during faults and resolves it in recovery', () => {
    const config = requiredScenarios().find(
      (scenario) => scenario.name === 'payment-callback-delay-duplicate-reorder',
    );
    expect(config).toBeDefined();
    const result = new EventSimulation(config!).run();
    expect(result.metrics.unknownPaymentsCreated).toBeGreaterThan(0);
    expect(result.metrics.unknownPaymentsAtEnd).toBe(0);
  });

  it('passes invariant assertions for the required modeled suite', () => {
    const suite = runRequiredSuite(new Date('2026-08-14T18:00:00.000Z'));
    const failed = suite.results.flatMap((result) =>
      result.assertions.filter((assertion) => !assertion.passed).map((assertion) => ({
        scenario: result.scenario,
        assertion: assertion.id,
        observed: assertion.observed,
      })),
    );
    expect(failed).toEqual([]);
    expect(suite.passed).toBe(true);
  });
});
