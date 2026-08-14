import { EventSimulation } from './simulator';
import type { SimulationConfig, SuiteResult } from './types';

const products = [
  { skuId: 'beer-500', weight: 5, openingStockPerBar: 500 },
  { skuId: 'water-500', weight: 3, openingStockPerBar: 420 },
  { skuId: 'soda-300', weight: 2, openingStockPerBar: 360 },
];

const payments = [
  { rail: 'cash' as const, weight: 3 },
  { rail: 'mpesa' as const, weight: 5 },
  { rail: 'pesapal_sabi' as const, weight: 2 },
];

function base(name: string, seed: number): SimulationConfig {
  return {
    name,
    seed,
    durationSeconds: 300,
    recoverySeconds: 180,
    bars: 4,
    registersPerBar: 3,
    transactionsPerMinutePerRegister: 8,
    productMix: products,
    paymentMix: payments,
    faults: {
      networkLatencyMs: 90,
      callbackDelayMinSeconds: 2,
      callbackDelayMaxSeconds: 8,
    },
  };
}

export function requiredScenarios(): SimulationConfig[] {
  const cloudOutage = base('cloud-outage-local-commerce-continues', 1001);
  cloudOutage.faults.cloudOutages = [{ startSecond: 60, endSecond: 180 }];
  cloudOutage.faults.callbackDuplicateRate = 0.05;

  const edgeCloudPartition = base('edge-cloud-partition-and-drain', 1002);
  edgeCloudPartition.faults.edgeCloudOutages = [{ startSecond: 45, endSecond: 210 }];

  const posIsolation = base('single-pos-isolated-then-reconnects', 1003);
  posIsolation.faults.posIsolations = [
    {
      startSecond: 30,
      endSecond: 180,
      registerIds: ['bar-1-register-1'],
    },
  ];

  const edgeRestart = base('edge-restart-under-backlog', 1004);
  edgeRestart.faults.edgeCloudOutages = [{ startSecond: 70, endSecond: 125 }];
  edgeRestart.faults.edgeRestartSeconds = [126, 155];
  edgeRestart.faults.syncDuplicateRate = 0.08;

  const largeReplay = base('large-sync-replay-duplicate-and-reorder', 1005);
  largeReplay.bars = 8;
  largeReplay.registersPerBar = 4;
  largeReplay.transactionsPerMinutePerRegister = 10;
  largeReplay.faults.edgeCloudOutages = [{ startSecond: 30, endSecond: 225 }];
  largeReplay.faults.syncDuplicateRate = 0.18;
  largeReplay.faults.syncReorderRate = 0.25;

  const callbacks = base('payment-callback-delay-duplicate-reorder', 1006);
  callbacks.faults.callbackDuplicateRate = 0.45;
  callbacks.faults.callbackDelayMinSeconds = 1;
  callbacks.faults.callbackDelayMaxSeconds = 45;
  callbacks.faults.callbackReorder = true;
  callbacks.faults.providerTimeoutRate = 0.12;

  const demandSpike = base('sudden-popular-product-demand-spike', 1007);
  demandSpike.productMix = [
    { skuId: 'beer-500', weight: 5, openingStockPerBar: 220 },
    { skuId: 'water-500', weight: 3, openingStockPerBar: 420 },
    { skuId: 'soda-300', weight: 2, openingStockPerBar: 360 },
  ];
  demandSpike.faults.demandSpikes = [
    { startSecond: 90, endSecond: 210, skuId: 'beer-500', multiplier: 6 },
  ];

  const replenishment = base('concurrent-sales-and-replenishment-transfers', 1008);
  replenishment.productMix = [
    { skuId: 'beer-500', weight: 6, openingStockPerBar: 100 },
    { skuId: 'water-500', weight: 3, openingStockPerBar: 240 },
    { skuId: 'soda-300', weight: 1, openingStockPerBar: 180 },
  ];
  replenishment.faults.demandSpikes = [
    { startSecond: 60, endSecond: 230, skuId: 'beer-500', multiplier: 4 },
  ];
  replenishment.faults.replenishment = [
    {
      startSecond: 50,
      endSecond: 250,
      skuId: 'beer-500',
      sourceStock: 1000,
      transferQuantity: 120,
      triggerBelow: 55,
    },
  ];
  replenishment.faults.edgeRestartSeconds = [145];

  const notificationOutage = base('notification-provider-outage', 1009);
  notificationOutage.faults.notificationOutages = [{ startSecond: 80, endSecond: 190 }];
  notificationOutage.faults.callbackDuplicateRate = 0.15;

  const slowDatabase = base('slow-cloud-database-under-load', 1010);
  slowDatabase.transactionsPerMinutePerRegister = 12;
  slowDatabase.faults.slowDatabase = [
    { startSecond: 70, endSecond: 205, extraLatencyMs: 850 },
  ];

  const wanFailover = base('application-level-wan-failover', 1011);
  wanFailover.faults.wanFailovers = [{ startSecond: 100, endSecond: 155 }];
  wanFailover.faults.networkLossRate = 0.03;
  wanFailover.faults.networkLatencyMs = 180;

  const combinedPeak = base('combined-peak-above-pilot-target', 1012);
  combinedPeak.bars = 10;
  combinedPeak.registersPerBar = 5;
  combinedPeak.transactionsPerMinutePerRegister = 12;
  combinedPeak.durationSeconds = 420;
  combinedPeak.recoverySeconds = 240;
  combinedPeak.productMix = [
    { skuId: 'beer-500', weight: 5, openingStockPerBar: 1200 },
    { skuId: 'water-500', weight: 3, openingStockPerBar: 1000 },
    { skuId: 'soda-300', weight: 2, openingStockPerBar: 900 },
  ];
  combinedPeak.faults.edgeCloudOutages = [{ startSecond: 90, endSecond: 240 }];
  combinedPeak.faults.edgeRestartSeconds = [245];
  combinedPeak.faults.syncDuplicateRate = 0.12;
  combinedPeak.faults.syncReorderRate = 0.12;
  combinedPeak.faults.callbackDuplicateRate = 0.2;
  combinedPeak.faults.callbackDelayMinSeconds = 2;
  combinedPeak.faults.callbackDelayMaxSeconds = 30;
  combinedPeak.faults.providerTimeoutRate = 0.08;
  combinedPeak.faults.notificationOutages = [{ startSecond: 150, endSecond: 205 }];
  combinedPeak.faults.slowDatabase = [
    { startSecond: 250, endSecond: 320, extraLatencyMs: 700 },
  ];

  return [
    cloudOutage,
    edgeCloudPartition,
    posIsolation,
    edgeRestart,
    largeReplay,
    callbacks,
    demandSpike,
    replenishment,
    notificationOutage,
    slowDatabase,
    wanFailover,
    combinedPeak,
  ];
}

export function runRequiredSuite(now: Date = new Date()): SuiteResult {
  const results = requiredScenarios().map((config) => new EventSimulation(config).run());
  return {
    generatedAt: now.toISOString(),
    results,
    passed: results.every((result) => result.passed),
  };
}
