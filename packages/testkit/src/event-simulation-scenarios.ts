import {
  runEventSimulation,
  type FaultWindow,
  type SimulationConfig,
  type SimulationResult,
} from './event-simulation';

const products = [
  { skuId: 'beer-500', openingStockBase: 12_000, weight: 5 },
  { skuId: 'water-500', openingStockBase: 9_000, weight: 3 },
  { skuId: 'soda-300', openingStockBase: 7_000, weight: 2 },
] as const;

const paymentMix = [
  { rail: 'cash' as const, weight: 3 },
  { rail: 'mpesa' as const, weight: 5 },
  { rail: 'pesapal_sabi' as const, weight: 2 },
];

function base(
  name: string,
  seed: number,
  faults: FaultWindow[] = [],
): SimulationConfig {
  return {
    name,
    seed,
    bars: 8,
    registersPerBar: 6,
    transactionRatePerSecond: 18,
    durationMs: 120_000,
    recoveryMs: 120_000,
    tickMs: 100,
    edgeIngressPerSecond: 140,
    cloudIngressPerSecond: 110,
    products: products.map((product) => ({ ...product })),
    paymentMix: paymentMix.map((entry) => ({ ...entry })),
    faults,
    providerBaseDelayMs: 1_200,
    paymentUnknownAfterMs: 5_000,
    dashboardRefreshMs: 1_000,
  };
}

export function releaseGateScenarioConfigs(): SimulationConfig[] {
  return [
    base('cloud-outage-ordering-continues', 101, [
      { kind: 'CLOUD_OUTAGE', startMs: 15_000, endMs: 120_000 },
    ]),
    base('edge-cloud-partition-and-convergence', 102, [
      { kind: 'EDGE_CLOUD_PARTITION', startMs: 20_000, endMs: 120_000 },
    ]),
    base('isolated-pos-reconnects', 103, [
      {
        kind: 'POS_ISOLATION',
        startMs: 10_000,
        endMs: 120_000,
        isolatedDeviceFraction: 0.25,
      },
    ]),
    base('edge-restart-with-durable-backlog', 104, [
      { kind: 'EDGE_RESTART', startMs: 90_000, endMs: 120_000 },
    ]),
    base('large-replay-is-idempotent', 105, [
      {
        kind: 'POS_ISOLATION',
        startMs: 5_000,
        endMs: 120_000,
        isolatedDeviceFraction: 1,
      },
      { kind: 'DUPLICATE_REPLAY', startMs: 120_000, endMs: 150_000 },
    ]),
    base('payment-callback-delay-duplicate-reorder', 106, [
      {
        kind: 'PAYMENT_CALLBACK_CHAOS',
        startMs: 15_000,
        endMs: 120_000,
        callbackDelayMs: 10_000,
        duplicateCallbacks: 2,
      },
    ]),
    base('popular-product-demand-spike', 107, [
      {
        kind: 'DEMAND_SPIKE',
        startMs: 25_000,
        endMs: 85_000,
        skuId: 'beer-500',
        demandMultiplier: 9,
      },
    ]),
    {
      ...base('sales-with-replenishment-transfer', 108),
      transfers: [
        {
          id: 'transfer-1',
          atMs: 45_000,
          skuId: 'beer-500',
          destinationBarId: 'bar-1',
          quantityBase: 600,
        },
      ],
    },
    base('notification-outage-is-non-blocking', 109, [
      { kind: 'NOTIFICATION_OUTAGE', startMs: 20_000, endMs: 100_000 },
      {
        kind: 'DEMAND_SPIKE',
        startMs: 20_000,
        endMs: 100_000,
        skuId: 'beer-500',
        demandMultiplier: 12,
      },
    ]),
    base('slow-edge-cloud-dependency-recovers', 110, [
      {
        kind: 'SLOW_DEPENDENCY',
        startMs: 15_000,
        endMs: 120_000,
        dependencyCapacityFactor: 0.08,
      },
    ]),
    base('wan-failover-at-application-boundary', 111, [
      {
        kind: 'WAN_FAILOVER',
        startMs: 90_000,
        endMs: 150_000,
        failoverDelayMs: 30_000,
      },
    ]),
  ];
}

export function runReleaseGateScenarios(): SimulationResult[] {
  return releaseGateScenarioConfigs().map(runEventSimulation);
}
