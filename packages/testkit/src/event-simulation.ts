export type PaymentRail = 'cash' | 'mpesa' | 'pesapal_sabi' | 'external_terminal';

export type FaultKind =
  | 'CLOUD_OUTAGE'
  | 'EDGE_CLOUD_PARTITION'
  | 'POS_ISOLATION'
  | 'EDGE_RESTART'
  | 'DUPLICATE_REPLAY'
  | 'PAYMENT_CALLBACK_CHAOS'
  | 'DEMAND_SPIKE'
  | 'NOTIFICATION_OUTAGE'
  | 'SLOW_DEPENDENCY'
  | 'WAN_FAILOVER';

export interface SimulationProduct {
  skuId: string;
  openingStockBase: number;
  weight: number;
}

export interface PaymentMixEntry {
  rail: PaymentRail;
  weight: number;
}

export interface FaultWindow {
  kind: FaultKind;
  startMs: number;
  endMs: number;
  targetDeviceIds?: string[];
  isolatedDeviceFraction?: number;
  skuId?: string;
  demandMultiplier?: number;
  callbackDelayMs?: number;
  duplicateCallbacks?: number;
  dependencyCapacityFactor?: number;
  failoverDelayMs?: number;
}

export interface TransferPlan {
  id: string;
  atMs: number;
  skuId: string;
  destinationBarId: string;
  quantityBase: number;
}

export interface SimulationConfig {
  name: string;
  seed: number;
  bars: number;
  registersPerBar: number;
  transactionRatePerSecond: number;
  durationMs: number;
  recoveryMs: number;
  tickMs: number;
  edgeIngressPerSecond: number;
  cloudIngressPerSecond: number;
  products: SimulationProduct[];
  paymentMix: PaymentMixEntry[];
  faults: FaultWindow[];
  transfers?: TransferPlan[];
  providerBaseDelayMs?: number;
  paymentUnknownAfterMs?: number;
  dashboardRefreshMs?: number;
}

export interface SimulationMetrics {
  evidenceKind: 'DETERMINISTIC_MODEL';
  scenarioName: string;
  generatedOrders: number;
  durableLocalOrders: number;
  edgeOrders: number;
  cloudOrders: number;
  committedOrderDurability: number;
  generatedThroughputPerSecond: number;
  convergedThroughputPerSecond: number;
  modeledLocalCommitLatencyP95Ms: number;
  maxSyncBacklog: number;
  finalSyncBacklog: number;
  syncBacklogDrainMs: number | null;
  duplicateDeliveriesIgnored: number;
  duplicateBusinessEffects: number;
  paymentAttempts: number;
  paymentUnknownPeak: number;
  paymentUnknownFinal: number;
  paymentUnknownPeakRate: number;
  falsePaymentFailures: number;
  providerCallbacksDelivered: number;
  providerCallbackDuplicatesIgnored: number;
  dashboardLagP95Ms: number;
  dashboardLagFinalMs: number;
  applicationErrors: number;
  dependencyFaultsObserved: number;
  notificationFailures: number;
  stockoutObservations: number;
  inventoryConverged: boolean;
  inventoryDifferences: Record<string, string>;
  edgeRestartCount: number;
  transferBusinessEffects: number;
  ordersBySku: Record<string, number>;
  ordersByPaymentRail: Record<PaymentRail, number>;
}

export interface SimulationResult {
  config: SimulationConfig;
  metrics: SimulationMetrics;
}

interface OrderEvent {
  kind: 'ORDER';
  id: string;
  orderId: string;
  deviceId: string;
  barId: string;
  skuId: string;
  paymentRail: PaymentRail;
  sequence: number;
  occurredAtMs: number;
}

interface TransferEvent {
  kind: 'TRANSFER';
  id: string;
  transferId: string;
  skuId: string;
  sourceLocationId: 'warehouse';
  destinationLocationId: string;
  quantityBase: number;
  occurredAtMs: number;
}

type SyncEvent = OrderEvent | TransferEvent;

type PaymentState = 'PENDING' | 'UNKNOWN' | 'SUCCEEDED' | 'FAILED';

interface DeviceState {
  id: string;
  barId: string;
  nextSequence: number;
  durableOrderIds: Set<string>;
  outbox: OrderEvent[];
}

interface PaymentAttempt {
  id: string;
  orderId: string;
  rail: Exclude<PaymentRail, 'cash'>;
  state: PaymentState;
  createdAtMs: number;
  updatedAtMs: number;
}

interface ProviderCallback {
  id: string;
  attemptId: string;
  deliverAtMs: number;
}

class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 0x9e3779b9;
  }

  next(): number {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state / 0x1_0000_0000;
  }

  weightedIndex(weights: readonly number[]): number {
    const total = weights.reduce((sum, value) => sum + Math.max(0, value), 0);
    if (total <= 0) throw new Error('weighted selection requires a positive total weight');
    let target = this.next() * total;
    for (let index = 0; index < weights.length; index += 1) {
      target -= Math.max(0, weights[index] ?? 0);
      if (target < 0) return index;
    }
    return weights.length - 1;
  }
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1),
  );
  return sorted[index] ?? 0;
}

function activeFaults(
  config: SimulationConfig,
  nowMs: number,
  kind?: FaultKind,
): FaultWindow[] {
  return config.faults.filter(
    (fault) =>
      fault.startMs <= nowMs &&
      nowMs < fault.endMs &&
      (!kind || fault.kind === kind),
  );
}

function validateConfig(config: SimulationConfig): void {
  const positiveIntegers = [
    ['bars', config.bars],
    ['registersPerBar', config.registersPerBar],
    ['durationMs', config.durationMs],
    ['recoveryMs', config.recoveryMs],
    ['tickMs', config.tickMs],
  ] as const;
  positiveIntegers.forEach(([name, value]) => {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`${name} must be a positive integer`);
    }
  });
  if (!(config.transactionRatePerSecond > 0)) {
    throw new Error('transactionRatePerSecond must be positive');
  }
  if (!(config.edgeIngressPerSecond > 0)) {
    throw new Error('edgeIngressPerSecond must be positive');
  }
  if (!(config.cloudIngressPerSecond > 0)) {
    throw new Error('cloudIngressPerSecond must be positive');
  }
  if (
    config.products.length === 0 ||
    config.products.some((product) => product.weight <= 0)
  ) {
    throw new Error('products must contain positive weights');
  }
  if (
    config.paymentMix.length === 0 ||
    config.paymentMix.some((entry) => entry.weight <= 0)
  ) {
    throw new Error('paymentMix must contain positive weights');
  }
  config.faults.forEach((fault) => {
    if (fault.startMs < 0 || fault.endMs <= fault.startMs) {
      throw new Error(`invalid ${fault.kind} window`);
    }
  });
}

export function runEventSimulation(config: SimulationConfig): SimulationResult {
  validateConfig(config);
  const rng = new Rng(config.seed);
  const totalMs = config.durationMs + config.recoveryMs;
  const providerBaseDelayMs = config.providerBaseDelayMs ?? 1_200;
  const paymentUnknownAfterMs = config.paymentUnknownAfterMs ?? 5_000;
  const dashboardRefreshMs = config.dashboardRefreshMs ?? 1_000;

  const devices: DeviceState[] = [];
  for (let barIndex = 0; barIndex < config.bars; barIndex += 1) {
    const barId = `bar-${barIndex + 1}`;
    for (
      let registerIndex = 0;
      registerIndex < config.registersPerBar;
      registerIndex += 1
    ) {
      devices.push({
        id: `${barId}-register-${registerIndex + 1}`,
        barId,
        nextSequence: 1,
        durableOrderIds: new Set<string>(),
        outbox: [],
      });
    }
  }

  const edgeProcessed = new Set<string>();
  const cloudProcessed = new Set<string>();
  const edgeCloudOutbox: SyncEvent[] = [];
  const edgeInventory = new Map<string, bigint>();
  const cloudInventory = new Map<string, bigint>();
  const transferAppliedAtEdge = new Set<string>();
  const paymentAttempts = new Map<string, PaymentAttempt>();
  const providerCallbacks: ProviderCallback[] = [];
  const providerCallbackProcessed = new Set<string>();
  const scheduledTransfers = new Set<string>();

  const localCommitLatencies: number[] = [];
  const dashboardLags: number[] = [];
  const ordersBySku = new Map<string, number>();
  const ordersByPaymentRail = new Map<PaymentRail, number>();
  let generatedOrders = 0;
  let duplicateDeliveriesIgnored = 0;
  let duplicateBusinessEffects = 0;
  let paymentUnknownPeak = 0;
  let providerCallbacksDelivered = 0;
  let providerCallbackDuplicatesIgnored = 0;
  let applicationErrors = 0;
  let dependencyFaultsObserved = 0;
  let notificationFailures = 0;
  let stockoutObservations = 0;
  let edgeRestartCount = 0;
  let transferBusinessEffects = 0;
  let maxSyncBacklog = 0;
  let lastCloudOrderOccurredAtMs = 0;
  let lastLocalOrderOccurredAtMs = 0;
  let lastDashboardRefreshMs = 0;
  let dashboardVisibleThroughMs = 0;
  let transactionAccumulator = 0;
  let edgeCapacityAccumulator = 0;
  let cloudCapacityAccumulator = 0;
  let drainAtMs: number | null = null;
  let previousEdgeRestartActive = false;

  const openingWarehouseFraction = 0.3;
  for (const product of config.products) {
    const warehouse = BigInt(
      Math.floor(product.openingStockBase * openingWarehouseFraction),
    );
    const barsTotal = BigInt(product.openingStockBase) - warehouse;
    edgeInventory.set(`warehouse|${product.skuId}`, warehouse);
    cloudInventory.set(`warehouse|${product.skuId}`, warehouse);
    const perBar = barsTotal / BigInt(config.bars);
    let remainder = barsTotal - perBar * BigInt(config.bars);
    for (let barIndex = 0; barIndex < config.bars; barIndex += 1) {
      const barId = `bar-${barIndex + 1}`;
      const extra = remainder > 0n ? 1n : 0n;
      if (remainder > 0n) remainder -= 1n;
      const quantity = perBar + extra;
      edgeInventory.set(`${barId}|${product.skuId}`, quantity);
      cloudInventory.set(`${barId}|${product.skuId}`, quantity);
    }
  }

  function applyInventory(map: Map<string, bigint>, event: SyncEvent): void {
    if (event.kind === 'ORDER') {
      const key = `${event.barId}|${event.skuId}`;
      const next = (map.get(key) ?? 0n) - 1n;
      map.set(key, next);
      if (map === edgeInventory && next < 0n) stockoutObservations += 1;
      return;
    }
    const sourceKey = `${event.sourceLocationId}|${event.skuId}`;
    const destinationKey = `${event.destinationLocationId}|${event.skuId}`;
    map.set(
      sourceKey,
      (map.get(sourceKey) ?? 0n) - BigInt(event.quantityBase),
    );
    map.set(
      destinationKey,
      (map.get(destinationKey) ?? 0n) + BigInt(event.quantityBase),
    );
  }

  function createElectronicAttempt(order: OrderEvent, nowMs: number): void {
    if (order.paymentRail === 'cash') return;
    const attemptId = `attempt-${order.orderId}`;
    if (paymentAttempts.has(attemptId)) return;
    paymentAttempts.set(attemptId, {
      id: attemptId,
      orderId: order.orderId,
      rail: order.paymentRail,
      state: 'PENDING',
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    });

    const chaos = activeFaults(config, nowMs, 'PAYMENT_CALLBACK_CHAOS')[0];
    const delay = providerBaseDelayMs + (chaos?.callbackDelayMs ?? 0);
    const duplicates = Math.max(0, chaos?.duplicateCallbacks ?? 0);
    const callbackId = `callback-${attemptId}`;
    providerCallbacks.push({
      id: callbackId,
      attemptId,
      deliverAtMs: nowMs + delay,
    });
    for (let index = 0; index < duplicates; index += 1) {
      const jitter = Math.floor(rng.next() * Math.max(config.tickMs, delay));
      providerCallbacks.push({
        id: callbackId,
        attemptId,
        deliverAtMs: nowMs + Math.max(config.tickMs, delay - jitter),
      });
    }
  }

  function handleCloudEvent(event: SyncEvent, nowMs: number): void {
    if (cloudProcessed.has(event.id)) {
      duplicateDeliveriesIgnored += 1;
      return;
    }
    cloudProcessed.add(event.id);
    applyInventory(cloudInventory, event);
    if (event.kind === 'ORDER') {
      lastCloudOrderOccurredAtMs = Math.max(
        lastCloudOrderOccurredAtMs,
        event.occurredAtMs,
      );
      createElectronicAttempt(event, nowMs);
    }
  }

  function cloudAvailable(nowMs: number): boolean {
    if (activeFaults(config, nowMs, 'CLOUD_OUTAGE').length > 0) return false;
    if (activeFaults(config, nowMs, 'EDGE_CLOUD_PARTITION').length > 0) {
      return false;
    }
    const wan = activeFaults(config, nowMs, 'WAN_FAILOVER')[0];
    if (wan) {
      const delay =
        wan.failoverDelayMs ?? Math.floor((wan.endMs - wan.startMs) / 2);
      if (nowMs < wan.startMs + delay) return false;
    }
    return true;
  }

  function edgeRestartActive(nowMs: number): boolean {
    return activeFaults(config, nowMs, 'EDGE_RESTART').length > 0;
  }

  function isolated(device: DeviceState, nowMs: number): boolean {
    for (const fault of activeFaults(config, nowMs, 'POS_ISOLATION')) {
      if (fault.targetDeviceIds?.includes(device.id)) return true;
      if (fault.isolatedDeviceFraction) {
        const count = Math.max(
          1,
          Math.floor(devices.length * fault.isolatedDeviceFraction),
        );
        if (
          devices.slice(0, count).some((candidate) => candidate.id === device.id)
        ) {
          return true;
        }
      }
    }
    return false;
  }

  function dependencyCapacityFactor(nowMs: number): number {
    const slow = activeFaults(config, nowMs, 'SLOW_DEPENDENCY');
    if (slow.length === 0) return 1;
    dependencyFaultsObserved += 1;
    return Math.min(
      ...slow.map((fault) => fault.dependencyCapacityFactor ?? 0.2),
    );
  }

  function chooseProduct(nowMs: number): SimulationProduct {
    const weights = config.products.map((product) => {
      const spike = activeFaults(config, nowMs, 'DEMAND_SPIKE').find(
        (fault) => fault.skuId === product.skuId,
      );
      return product.weight * (spike?.demandMultiplier ?? 1);
    });
    return config.products[rng.weightedIndex(weights)]!;
  }

  function choosePaymentRail(): PaymentRail {
    return config.paymentMix[
      rng.weightedIndex(config.paymentMix.map((item) => item.weight))
    ]!.rail;
  }

  function generateOrder(nowMs: number): void {
    const device = devices[generatedOrders % devices.length]!;
    const product = chooseProduct(nowMs);
    const rail = choosePaymentRail();
    generatedOrders += 1;
    lastLocalOrderOccurredAtMs = nowMs;
    ordersBySku.set(product.skuId, (ordersBySku.get(product.skuId) ?? 0) + 1);
    ordersByPaymentRail.set(
      rail,
      (ordersByPaymentRail.get(rail) ?? 0) + 1,
    );
    const orderId = `order-${generatedOrders}`;
    const event: OrderEvent = {
      kind: 'ORDER',
      id: `order-event-${orderId}`,
      orderId,
      deviceId: device.id,
      barId: device.barId,
      skuId: product.skuId,
      paymentRail: rail,
      sequence: device.nextSequence,
      occurredAtMs: nowMs,
    };
    device.nextSequence += 1;
    device.durableOrderIds.add(orderId);
    device.outbox.push(event);
    localCommitLatencies.push(35 + Math.floor(rng.next() * 65));
  }

  function scheduleTransfers(nowMs: number): void {
    for (const transfer of config.transfers ?? []) {
      if (transfer.atMs > nowMs || scheduledTransfers.has(transfer.id)) continue;
      scheduledTransfers.add(transfer.id);
      const event: TransferEvent = {
        kind: 'TRANSFER',
        id: `transfer-event-${transfer.id}`,
        transferId: transfer.id,
        skuId: transfer.skuId,
        sourceLocationId: 'warehouse',
        destinationLocationId: transfer.destinationBarId,
        quantityBase: transfer.quantityBase,
        occurredAtMs: nowMs,
      };
      if (!transferAppliedAtEdge.has(transfer.id)) {
        transferAppliedAtEdge.add(transfer.id);
        applyInventory(edgeInventory, event);
        transferBusinessEffects += 1;
      }
      edgeCloudOutbox.push(event);
    }
  }

  function deliverDeviceEvents(nowMs: number, capacity: number): void {
    let remaining = capacity;
    while (remaining > 0) {
      const eligible = devices.filter(
        (device) => device.outbox.length > 0 && !isolated(device, nowMs),
      );
      if (eligible.length === 0) return;
      for (const device of eligible) {
        if (remaining <= 0) return;
        const event = device.outbox[0]!;
        const replay =
          activeFaults(config, nowMs, 'DUPLICATE_REPLAY').length > 0;
        for (const delivery of replay ? [event, event] : [event]) {
          if (edgeProcessed.has(delivery.id)) {
            duplicateDeliveriesIgnored += 1;
          } else {
            edgeProcessed.add(delivery.id);
            applyInventory(edgeInventory, delivery);
            edgeCloudOutbox.push(delivery);
          }
        }
        device.outbox.shift();
        remaining -= 1;
      }
    }
  }

  function deliverCloudEvents(nowMs: number, capacity: number): void {
    if (!cloudAvailable(nowMs)) {
      dependencyFaultsObserved += 1;
      return;
    }
    let remaining = capacity;
    while (remaining > 0 && edgeCloudOutbox.length > 0) {
      handleCloudEvent(edgeCloudOutbox.shift()!, nowMs);
      remaining -= 1;
    }
  }

  function deliverProviderCallbacks(nowMs: number): void {
    const due = providerCallbacks
      .filter((callback) => callback.deliverAtMs <= nowMs)
      .sort(
        (left, right) =>
          left.deliverAtMs - right.deliverAtMs || left.id.localeCompare(right.id),
      );
    if (!cloudAvailable(nowMs)) return;
    for (const callback of due) {
      const index = providerCallbacks.indexOf(callback);
      if (index >= 0) providerCallbacks.splice(index, 1);
      if (providerCallbackProcessed.has(callback.id)) {
        providerCallbackDuplicatesIgnored += 1;
        continue;
      }
      providerCallbackProcessed.add(callback.id);
      const attempt = paymentAttempts.get(callback.attemptId);
      if (!attempt) {
        applicationErrors += 1;
        continue;
      }
      providerCallbacksDelivered += 1;
      if (attempt.state === 'FAILED') {
        duplicateBusinessEffects += 1;
        continue;
      }
      attempt.state = 'SUCCEEDED';
      attempt.updatedAtMs = nowMs;
    }
  }

  function agePayments(nowMs: number): void {
    for (const attempt of paymentAttempts.values()) {
      if (
        attempt.state === 'PENDING' &&
        nowMs - attempt.createdAtMs >= paymentUnknownAfterMs
      ) {
        attempt.state = 'UNKNOWN';
        attempt.updatedAtMs = nowMs;
      }
    }
    const unknown = [...paymentAttempts.values()].filter(
      (attempt) => attempt.state === 'UNKNOWN',
    ).length;
    paymentUnknownPeak = Math.max(paymentUnknownPeak, unknown);
  }

  function maybeNotify(nowMs: number): void {
    if (
      activeFaults(config, nowMs, 'NOTIFICATION_OUTAGE').length > 0 &&
      nowMs % 1_000 === 0
    ) {
      notificationFailures += 1;
    }
  }

  function syncBacklog(): number {
    return (
      devices.reduce((sum, device) => sum + device.outbox.length, 0) +
      edgeCloudOutbox.length
    );
  }

  for (let nowMs = 0; nowMs <= totalMs; nowMs += config.tickMs) {
    const edgeRestart = edgeRestartActive(nowMs);
    if (edgeRestart && !previousEdgeRestartActive) edgeRestartCount += 1;
    previousEdgeRestartActive = edgeRestart;

    if (nowMs < config.durationMs) {
      transactionAccumulator +=
        (config.transactionRatePerSecond * config.tickMs) / 1_000;
      const count = Math.floor(transactionAccumulator);
      transactionAccumulator -= count;
      for (let index = 0; index < count; index += 1) generateOrder(nowMs);
    }

    scheduleTransfers(nowMs);

    const capacityFactor = dependencyCapacityFactor(nowMs);
    edgeCapacityAccumulator +=
      (config.edgeIngressPerSecond * config.tickMs * capacityFactor) / 1_000;
    cloudCapacityAccumulator +=
      (config.cloudIngressPerSecond * config.tickMs * capacityFactor) / 1_000;
    const edgeCapacity = Math.floor(edgeCapacityAccumulator);
    const cloudCapacity = Math.floor(cloudCapacityAccumulator);
    edgeCapacityAccumulator -= edgeCapacity;
    cloudCapacityAccumulator -= cloudCapacity;

    if (!edgeRestart) {
      deliverDeviceEvents(nowMs, edgeCapacity);
      deliverCloudEvents(nowMs, cloudCapacity);
    } else {
      dependencyFaultsObserved += 1;
    }

    deliverProviderCallbacks(nowMs);
    agePayments(nowMs);
    maybeNotify(nowMs);

    if (nowMs - lastDashboardRefreshMs >= dashboardRefreshMs) {
      lastDashboardRefreshMs = nowMs;
      dashboardVisibleThroughMs = lastCloudOrderOccurredAtMs;
    }
    dashboardLags.push(
      Math.max(0, lastLocalOrderOccurredAtMs - dashboardVisibleThroughMs),
    );

    const backlog = syncBacklog();
    maxSyncBacklog = Math.max(maxSyncBacklog, backlog);
    if (nowMs >= config.durationMs && backlog === 0 && drainAtMs === null) {
      drainAtMs = nowMs;
    }
  }

  const durableLocalOrders = devices.reduce(
    (sum, device) => sum + device.durableOrderIds.size,
    0,
  );
  const edgeOrders = [...edgeProcessed].filter((id) =>
    id.startsWith('order-event-'),
  ).length;
  const cloudOrders = [...cloudProcessed].filter((id) =>
    id.startsWith('order-event-'),
  ).length;
  const paymentAttemptList = [...paymentAttempts.values()];
  const paymentUnknownFinal = paymentAttemptList.filter(
    (attempt) => attempt.state === 'UNKNOWN',
  ).length;
  const falsePaymentFailures = paymentAttemptList.filter(
    (attempt) => attempt.state === 'FAILED',
  ).length;
  const finalSyncBacklog = syncBacklog();

  const inventoryDifferences: Record<string, string> = {};
  const inventoryKeys = new Set([
    ...edgeInventory.keys(),
    ...cloudInventory.keys(),
  ]);
  for (const key of [...inventoryKeys].sort()) {
    const edge = edgeInventory.get(key) ?? 0n;
    const cloud = cloudInventory.get(key) ?? 0n;
    if (edge !== cloud) inventoryDifferences[key] = (edge - cloud).toString();
  }

  return {
    config,
    metrics: {
      evidenceKind: 'DETERMINISTIC_MODEL',
      scenarioName: config.name,
      generatedOrders,
      durableLocalOrders,
      edgeOrders,
      cloudOrders,
      committedOrderDurability:
        generatedOrders === 0 ? 1 : durableLocalOrders / generatedOrders,
      generatedThroughputPerSecond:
        generatedOrders / (config.durationMs / 1_000),
      convergedThroughputPerSecond: cloudOrders / (totalMs / 1_000),
      modeledLocalCommitLatencyP95Ms: percentile(localCommitLatencies, 0.95),
      maxSyncBacklog,
      finalSyncBacklog,
      syncBacklogDrainMs:
        drainAtMs === null ? null : Math.max(0, drainAtMs - config.durationMs),
      duplicateDeliveriesIgnored,
      duplicateBusinessEffects,
      paymentAttempts: paymentAttemptList.length,
      paymentUnknownPeak,
      paymentUnknownFinal,
      paymentUnknownPeakRate:
        paymentAttemptList.length === 0
          ? 0
          : paymentUnknownPeak / paymentAttemptList.length,
      falsePaymentFailures,
      providerCallbacksDelivered,
      providerCallbackDuplicatesIgnored,
      dashboardLagP95Ms: percentile(dashboardLags, 0.95),
      dashboardLagFinalMs: dashboardLags.at(-1) ?? 0,
      applicationErrors,
      dependencyFaultsObserved,
      notificationFailures,
      stockoutObservations,
      inventoryConverged: Object.keys(inventoryDifferences).length === 0,
      inventoryDifferences,
      edgeRestartCount,
      transferBusinessEffects,
      ordersBySku: Object.fromEntries(
        [...ordersBySku.entries()].sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ),
      ordersByPaymentRail: {
        cash: ordersByPaymentRail.get('cash') ?? 0,
        mpesa: ordersByPaymentRail.get('mpesa') ?? 0,
        pesapal_sabi: ordersByPaymentRail.get('pesapal_sabi') ?? 0,
        external_terminal: ordersByPaymentRail.get('external_terminal') ?? 0,
      },
    },
  };
}
