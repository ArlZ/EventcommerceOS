export type PaymentRail = 'cash' | 'mpesa' | 'pesapal_sabi';

export interface ProductMixItem {
  skuId: string;
  weight: number;
  openingStockPerBar: number;
}

export interface PaymentMixItem {
  rail: PaymentRail;
  weight: number;
}

export interface TimeWindow {
  startSecond: number;
  endSecond: number;
}

export interface PosIsolationWindow extends TimeWindow {
  registerIds: string[];
}

export interface DemandSpike extends TimeWindow {
  skuId: string;
  multiplier: number;
}

export interface ReplenishmentPlan extends TimeWindow {
  skuId: string;
  sourceStock: number;
  transferQuantity: number;
  triggerBelow: number;
}

export interface SimulationFaults {
  cloudOutages?: TimeWindow[];
  edgeCloudOutages?: TimeWindow[];
  posIsolations?: PosIsolationWindow[];
  edgeRestartSeconds?: number[];
  callbackDuplicateRate?: number;
  callbackDelayMinSeconds?: number;
  callbackDelayMaxSeconds?: number;
  callbackReorder?: boolean;
  providerTimeoutRate?: number;
  notificationOutages?: TimeWindow[];
  slowDatabase?: Array<TimeWindow & { extraLatencyMs: number }>;
  wanFailovers?: TimeWindow[];
  demandSpikes?: DemandSpike[];
  replenishment?: ReplenishmentPlan[];
}

export interface SimulationConfig {
  name: string;
  seed: number;
  durationSeconds: number;
  recoverySeconds: number;
  bars: number;
  registersPerBar: number;
  transactionsPerMinutePerRegister: number;
  productMix: ProductMixItem[];
  paymentMix: PaymentMixItem[];
  faults: SimulationFaults;
}

export interface PercentileMetrics {
  p50: number;
  p95: number;
  max: number;
}

export interface SimulationMetrics {
  generatedOrders: number;
  committedOrders: number;
  lostCommittedOrders: number;
  completedPayments: number;
  unknownPaymentsCreated: number;
  unknownPaymentsAtEnd: number;
  duplicateProviderSignals: number;
  duplicateBusinessEffects: number;
  maxSyncBacklog: number;
  syncBacklogAtEnd: number;
  syncDrainSeconds: number | null;
  throughputPerMinute: number;
  interactionLatencyMs: PercentileMetrics;
  localCommitLatencyMs: PercentileMetrics;
  dashboardLagMs: PercentileMetrics;
  providerCallbackLatencyMs: PercentileMetrics;
  notificationDeliveryFailures: number;
  simulatedDependencyErrors: number;
  stockoutAttempts: number;
  transfersCreated: number;
  transfersCompleted: number;
  inventoryConverged: boolean;
  edgeCloudConverged: boolean;
}

export interface ReleaseAssertion {
  id: string;
  description: string;
  passed: boolean;
  observed: string;
}

export interface ScenarioResult {
  scenario: string;
  config: SimulationConfig;
  metrics: SimulationMetrics;
  assertions: ReleaseAssertion[];
  passed: boolean;
}

export interface SuiteResult {
  generatedAt: string;
  results: ScenarioResult[];
  passed: boolean;
}
