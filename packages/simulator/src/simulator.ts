import { DeterministicRandom } from './prng';
import type {
  PaymentRail,
  PercentileMetrics,
  ProductMixItem,
  ReleaseAssertion,
  ScenarioResult,
  SimulationConfig,
  SimulationMetrics,
  TimeWindow,
} from './types';

interface RegisterState {
  id: string;
  barIndex: number;
  accumulator: number;
}

interface SyncMutation {
  id: string;
  registerId: string;
  occurredSecond: number;
  kind: 'ORDER' | 'INVENTORY';
  orderId: string;
  barIndex?: number;
  skuId?: string;
  quantityDelta?: number;
}

interface PaymentState {
  id: string;
  orderId: string;
  rail: PaymentRail;
  createdSecond: number;
  dueSecond: number;
  status: 'PENDING' | 'UNKNOWN' | 'SUCCEEDED';
}

interface TransferState {
  id: string;
  barIndex: number;
  skuId: string;
  quantity: number;
  dueSecond: number;
  completed: boolean;
}

function inWindow(second: number, window: TimeWindow): boolean {
  return second >= window.startSecond && second <= window.endSecond;
}

function percentile(values: readonly number[]): PercentileMetrics {
  if (values.length === 0) return { p50: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (fraction: number): number => {
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
    return sorted[index] ?? 0;
  };
  return { p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] ?? 0 };
}

function rate(value: number | undefined): number {
  if (value === undefined) return 0;
  return Math.max(0, Math.min(1, value));
}

function positive(value: number | undefined, fallback: number): number {
  return value === undefined ? fallback : Math.max(0, value);
}

function lastRecoveryFaultSecond(config: SimulationConfig): number {
  const windows: TimeWindow[] = [
    ...(config.faults.cloudOutages ?? []),
    ...(config.faults.edgeCloudOutages ?? []),
    ...(config.faults.posIsolations ?? []),
    ...(config.faults.slowDatabase ?? []),
    ...(config.faults.wanFailovers ?? []),
  ];
  const windowEnd = windows.reduce((max, window) => Math.max(max, window.endSecond), 0);
  const restartEnd = (config.faults.edgeRestartSeconds ?? []).reduce(
    (max, second) => Math.max(max, second + 2),
    0,
  );
  return Math.max(windowEnd, restartEnd);
}

function inventoryKey(barIndex: number, skuId: string): string {
  return `${barIndex}|${skuId}`;
}

function validate(config: SimulationConfig): void {
  if (!config.name.trim()) throw new Error('simulation name is required');
  if (!Number.isInteger(config.durationSeconds) || config.durationSeconds <= 0) {
    throw new Error('durationSeconds must be a positive integer');
  }
  if (!Number.isInteger(config.recoverySeconds) || config.recoverySeconds < 0) {
    throw new Error('recoverySeconds must be a non-negative integer');
  }
  if (!Number.isInteger(config.bars) || config.bars <= 0) throw new Error('bars must be positive');
  if (!Number.isInteger(config.registersPerBar) || config.registersPerBar <= 0) {
    throw new Error('registersPerBar must be positive');
  }
  if (config.transactionsPerMinutePerRegister <= 0) {
    throw new Error('transactionsPerMinutePerRegister must be positive');
  }
  if (config.productMix.length === 0) throw new Error('productMix must not be empty');
  if (config.paymentMix.length === 0) throw new Error('paymentMix must not be empty');
  if (config.productMix.some((item) => item.weight <= 0 || item.openingStockPerBar < 0)) {
    throw new Error('product mix weights must be positive and opening stock non-negative');
  }
  if (config.paymentMix.some((item) => item.weight <= 0)) {
    throw new Error('payment mix weights must be positive');
  }
}

export class EventSimulation {
  private readonly random: DeterministicRandom;
  private readonly registers: RegisterState[] = [];
  private readonly physicalInventory = new Map<string, number>();
  private readonly edgeInventory = new Map<string, number>();
  private readonly cloudInventory = new Map<string, number>();
  private readonly localQueue: SyncMutation[] = [];
  private readonly edgeQueue: SyncMutation[] = [];
  private readonly edgeApplied = new Set<string>();
  private readonly cloudApplied = new Set<string>();
  private readonly durableOrders = new Set<string>();
  private readonly cloudOrders = new Set<string>();
  private readonly payments: PaymentState[] = [];
  private readonly appliedPaymentSignals = new Set<string>();
  private readonly transfers: TransferState[] = [];
  private readonly replenishmentUsage = new Set<string>();
  private readonly replenishmentRemaining = new Map<string, number>();
  private readonly interactionLatencies: number[] = [];
  private readonly localCommitLatencies: number[] = [];
  private readonly dashboardLags: number[] = [];
  private readonly providerCallbackLatencies: number[] = [];
  private generatedOrders = 0;
  private committedOrderWrites = 0;
  private stockoutAttempts = 0;
  private unknownPaymentsCreated = 0;
  private duplicateSyncDeliveries = 0;
  private duplicateProviderSignals = 0;
  private duplicateBusinessEffects = 0;
  private notificationDeliveryFailures = 0;
  private simulatedDependencyErrors = 0;
  private maxSyncBacklog = 0;
  private transfersCreated = 0;
  private transfersCompleted = 0;
  private sequence = 0;
  private inventoryConvergenceSecond: number | null = null;
  private syncDrainSecond: number | null = null;

  constructor(private readonly config: SimulationConfig) {
    validate(config);
    this.random = new DeterministicRandom(config.seed);
    for (let barIndex = 0; barIndex < config.bars; barIndex += 1) {
      for (let registerIndex = 0; registerIndex < config.registersPerBar; registerIndex += 1) {
        this.registers.push({
          id: `bar-${barIndex + 1}-register-${registerIndex + 1}`,
          barIndex,
          accumulator: 0,
        });
      }
      for (const product of config.productMix) {
        const key = inventoryKey(barIndex, product.skuId);
        this.physicalInventory.set(key, product.openingStockPerBar);
        this.edgeInventory.set(key, product.openingStockPerBar);
        this.cloudInventory.set(key, product.openingStockPerBar);
      }
    }
  }

  run(): ScenarioResult {
    const finalSecond = this.config.durationSeconds + this.config.recoverySeconds;
    const recoveryFaultEnd = lastRecoveryFaultSecond(this.config);

    for (let second = 0; second <= finalSecond; second += 1) {
      if (second < this.config.durationSeconds) this.generateTraffic(second);
      this.maybeCreateTransfers(second);
      this.completeTransfers(second);
      this.drainLocalQueue(second);
      this.drainEdgeQueue(second);
      this.processPaymentSignals(second);
      this.processOperationalNotifications(second);
      this.observeBacklog(second, recoveryFaultEnd);
      this.observeConvergence(second);
    }

    const metrics = this.metrics(recoveryFaultEnd);
    const assertions = this.assertions(metrics);
    return {
      scenario: this.config.name,
      config: this.config,
      metrics,
      assertions,
      passed: assertions.every((assertion) => assertion.passed),
    };
  }

  private generateTraffic(second: number): void {
    const ratePerSecond = this.config.transactionsPerMinutePerRegister / 60;
    for (const register of this.registers) {
      register.accumulator += ratePerSecond;
      while (register.accumulator >= 1) {
        register.accumulator -= 1;
        this.createSale(register, second);
      }
    }
  }

  private createSale(register: RegisterState, second: number): void {
    this.generatedOrders += 1;
    const product = this.random.weighted(this.config.productMix, (item) =>
      this.productWeight(item, second),
    );
    const key = inventoryKey(register.barIndex, product.skuId);
    const physical = this.physicalInventory.get(key) ?? 0;
    if (physical <= 0) {
      this.stockoutAttempts += 1;
      return;
    }

    this.physicalInventory.set(key, physical - 1);
    const orderId = `order-${++this.sequence}`;
    this.committedOrderWrites += 1;
    this.durableOrders.add(orderId);

    const congestion = Math.max(0, this.config.transactionsPerMinutePerRegister - 10);
    this.interactionLatencies.push(18 + this.random.integer(0, 45) + Math.round(congestion * 1.5));
    this.localCommitLatencies.push(42 + this.random.integer(0, 80) + Math.round(congestion * 2));

    const orderMutation: SyncMutation = {
      id: `${orderId}:order`,
      registerId: register.id,
      occurredSecond: second,
      kind: 'ORDER',
      orderId,
    };
    const inventoryMutation: SyncMutation = {
      id: `${orderId}:inventory:${product.skuId}`,
      registerId: register.id,
      occurredSecond: second,
      kind: 'INVENTORY',
      orderId,
      barIndex: register.barIndex,
      skuId: product.skuId,
      quantityDelta: -1,
    };
    this.localQueue.push(orderMutation, inventoryMutation);

    const payment = this.random.weighted(this.config.paymentMix, (item) => item.weight);
    if (payment.rail === 'cash') {
      this.payments.push({
        id: `${orderId}:cash`,
        orderId,
        rail: 'cash',
        createdSecond: second,
        dueSecond: second,
        status: 'SUCCEEDED',
      });
      return;
    }

    const requestReachable =
      this.posToEdgeAvailable(register.id, second) && this.edgeToCloudAvailable(second);
    const timeout = this.random.chance(rate(this.config.faults.providerTimeoutRate));
    const status: PaymentState['status'] = requestReachable && !timeout ? 'PENDING' : 'UNKNOWN';
    if (status === 'UNKNOWN') this.unknownPaymentsCreated += 1;

    const minDelay = Math.floor(positive(this.config.faults.callbackDelayMinSeconds, 2));
    const maxDelay = Math.max(
      minDelay,
      Math.floor(positive(this.config.faults.callbackDelayMaxSeconds, 8)),
    );
    let delay = this.random.integer(minDelay, maxDelay);
    if (timeout) delay += 12;
    if (this.config.faults.callbackReorder && this.random.chance(0.35)) {
      delay += this.random.integer(1, 10);
    }
    this.payments.push({
      id: `${orderId}:${payment.rail}`,
      orderId,
      rail: payment.rail,
      createdSecond: second,
      dueSecond: second + delay,
      status,
    });
  }

  private productWeight(item: ProductMixItem, second: number): number {
    const spike = (this.config.faults.demandSpikes ?? []).find(
      (candidate) => candidate.skuId === item.skuId && inWindow(second, candidate),
    );
    return item.weight * (spike?.multiplier ?? 1);
  }

  private drainLocalQueue(second: number): void {
    const capacity = 250;
    let moved = 0;
    for (let index = 0; index < this.localQueue.length && moved < capacity; ) {
      const mutation = this.localQueue[index];
      if (!mutation) break;
      if (!this.posToEdgeAvailable(mutation.registerId, second)) {
        index += 1;
        continue;
      }
      if (this.random.chance(rate(this.config.faults.networkLossRate))) {
        this.simulatedDependencyErrors += 1;
        index += 1;
        continue;
      }
      this.localQueue.splice(index, 1);
      moved += 1;
      this.applyAtEdge(mutation);
      this.edgeQueue.push(mutation);
      if (this.random.chance(rate(this.config.faults.syncDuplicateRate))) {
        this.edgeQueue.push({ ...mutation });
      }
    }
  }

  private applyAtEdge(mutation: SyncMutation): void {
    if (this.edgeApplied.has(mutation.id)) return;
    this.edgeApplied.add(mutation.id);
    if (
      mutation.kind === 'INVENTORY' &&
      mutation.barIndex !== undefined &&
      mutation.skuId !== undefined &&
      mutation.quantityDelta !== undefined
    ) {
      const key = inventoryKey(mutation.barIndex, mutation.skuId);
      this.edgeInventory.set(key, (this.edgeInventory.get(key) ?? 0) + mutation.quantityDelta);
    }
  }

  private drainEdgeQueue(second: number): void {
    if (!this.edgeToCloudAvailable(second)) return;
    const slow = (this.config.faults.slowDatabase ?? []).find((window) => inWindow(second, window));
    const capacity = slow ? 20 : 300;
    if (slow && this.edgeQueue.length > 0) this.simulatedDependencyErrors += 1;

    if (this.config.faults.syncReorderRate && this.edgeQueue.length > 1) {
      if (this.random.chance(rate(this.config.faults.syncReorderRate))) {
        const first = this.edgeQueue.shift();
        const secondItem = this.edgeQueue.shift();
        if (secondItem) this.edgeQueue.unshift(secondItem);
        if (first) this.edgeQueue.push(first);
      }
    }

    let processed = 0;
    while (this.edgeQueue.length > 0 && processed < capacity) {
      if (this.random.chance(rate(this.config.faults.networkLossRate))) {
        this.simulatedDependencyErrors += 1;
        break;
      }
      const mutation = this.edgeQueue.shift();
      if (!mutation) break;
      processed += 1;
      this.applyAtCloud(mutation, second);
    }
  }

  private applyAtCloud(mutation: SyncMutation, second: number): void {
    if (this.cloudApplied.has(mutation.id)) {
      this.duplicateSyncDeliveries += 1;
      return;
    }
    this.cloudApplied.add(mutation.id);

    if (mutation.kind === 'ORDER') {
      const before = this.cloudOrders.size;
      this.cloudOrders.add(mutation.orderId);
      if (this.cloudOrders.size === before) this.duplicateBusinessEffects += 1;
    } else if (
      mutation.barIndex !== undefined &&
      mutation.skuId !== undefined &&
      mutation.quantityDelta !== undefined
    ) {
      const key = inventoryKey(mutation.barIndex, mutation.skuId);
      this.cloudInventory.set(key, (this.cloudInventory.get(key) ?? 0) + mutation.quantityDelta);
    }

    const networkLatency = positive(this.config.faults.networkLatencyMs, 80);
    this.dashboardLags.push((second - mutation.occurredSecond) * 1000 + networkLatency + 500);
  }

  private processPaymentSignals(second: number): void {
    for (const payment of this.payments) {
      if (payment.status === 'SUCCEEDED' || payment.dueSecond > second) continue;
      if (!this.edgeToCloudAvailable(second)) {
        payment.dueSecond = second + 1;
        continue;
      }
      this.applyPaymentSignal(payment, second);
      if (this.random.chance(rate(this.config.faults.callbackDuplicateRate))) {
        this.duplicateProviderSignals += 1;
        this.applyPaymentSignal(payment, second);
      }
    }
  }

  private processOperationalNotifications(second: number): void {
    if (second % 15 !== 0) return;
    if ((this.config.faults.notificationOutages ?? []).some((window) => inWindow(second, window))) {
      this.notificationDeliveryFailures += 1;
      this.simulatedDependencyErrors += 1;
    }
  }

  private applyPaymentSignal(payment: PaymentState, second: number): void {
    if (this.appliedPaymentSignals.has(payment.id)) return;
    this.appliedPaymentSignals.add(payment.id);
    payment.status = 'SUCCEEDED';
    this.providerCallbackLatencies.push((second - payment.createdSecond) * 1000);
  }

  private maybeCreateTransfers(second: number): void {
    for (const plan of this.config.faults.replenishment ?? []) {
      if (!inWindow(second, plan)) continue;
      const sourceKey = `${plan.skuId}|${plan.startSecond}|${plan.endSecond}`;
      if (!this.replenishmentRemaining.has(sourceKey)) {
        this.replenishmentRemaining.set(sourceKey, Math.max(0, plan.sourceStock));
      }
      for (let barIndex = 0; barIndex < this.config.bars; barIndex += 1) {
        const key = inventoryKey(barIndex, plan.skuId);
        const stock = this.physicalInventory.get(key) ?? 0;
        const useKey = `${sourceKey}|${barIndex}`;
        if (stock > plan.triggerBelow || this.replenishmentUsage.has(useKey)) continue;
        const available = this.replenishmentRemaining.get(sourceKey) ?? 0;
        const quantity = Math.min(available, Math.max(0, plan.transferQuantity));
        if (quantity <= 0) continue;
        this.replenishmentUsage.add(useKey);
        this.replenishmentRemaining.set(sourceKey, available - quantity);
        this.transfers.push({
          id: `transfer-${++this.sequence}`,
          barIndex,
          skuId: plan.skuId,
          quantity,
          dueSecond: second + 10,
          completed: false,
        });
        this.transfersCreated += 1;
      }
    }
  }

  private completeTransfers(second: number): void {
    for (const transfer of this.transfers) {
      if (transfer.completed || transfer.dueSecond > second) continue;
      if (!this.edgeAvailable(second)) {
        transfer.dueSecond = second + 1;
        continue;
      }
      const key = inventoryKey(transfer.barIndex, transfer.skuId);
      this.physicalInventory.set(key, (this.physicalInventory.get(key) ?? 0) + transfer.quantity);
      transfer.completed = true;
      this.transfersCompleted += 1;
      const mutation: SyncMutation = {
        id: `${transfer.id}:inventory`,
        registerId: `bar-${transfer.barIndex + 1}-register-1`,
        occurredSecond: second,
        kind: 'INVENTORY',
        orderId: transfer.id,
        barIndex: transfer.barIndex,
        skuId: transfer.skuId,
        quantityDelta: transfer.quantity,
      };
      this.applyAtEdge(mutation);
      this.edgeQueue.push(mutation);
    }
  }

  private observeBacklog(second: number, recoveryFaultEnd: number): void {
    const backlog = this.localQueue.length + this.edgeQueue.length;
    this.maxSyncBacklog = Math.max(this.maxSyncBacklog, backlog);
    if (second >= recoveryFaultEnd && backlog === 0 && this.syncDrainSecond === null) {
      this.syncDrainSecond = second;
    }
  }

  private observeConvergence(second: number): void {
    if (second < this.config.durationSeconds) return;
    if (this.inventoryConvergenceSecond !== null) return;
    if (
      this.inventoryEquals(this.physicalInventory, this.edgeInventory) &&
      this.inventoryEquals(this.physicalInventory, this.cloudInventory)
    ) {
      this.inventoryConvergenceSecond = second;
    }
  }

  private metrics(recoveryFaultEnd: number): SimulationMetrics {
    const completedPayments = this.payments.filter(
      (payment) => payment.status === 'SUCCEEDED',
    ).length;
    const unknownAtEnd = this.payments.filter((payment) => payment.status !== 'SUCCEEDED').length;
    const backlogAtEnd = this.localQueue.length + this.edgeQueue.length;
    const lostCommitted = Math.max(0, this.committedOrderWrites - this.durableOrders.size);
    const operations = Math.max(
      1,
      this.generatedOrders + this.cloudApplied.size + this.payments.length,
    );
    const inventoryConverged =
      this.inventoryEquals(this.physicalInventory, this.edgeInventory) &&
      this.inventoryEquals(this.physicalInventory, this.cloudInventory);
    const edgeCloudConverged =
      backlogAtEnd === 0 && this.cloudOrders.size === this.durableOrders.size && inventoryConverged;
    return {
      generatedOrders: this.generatedOrders,
      committedOrders: this.durableOrders.size,
      lostCommittedOrders: lostCommitted,
      completedPayments,
      unknownPaymentsCreated: this.unknownPaymentsCreated,
      unknownPaymentsAtEnd: unknownAtEnd,
      duplicateSyncDeliveries: this.duplicateSyncDeliveries,
      duplicateProviderSignals: this.duplicateProviderSignals,
      duplicateBusinessEffects: this.duplicateBusinessEffects,
      maxSyncBacklog: this.maxSyncBacklog,
      syncBacklogAtEnd: backlogAtEnd,
      syncDrainSeconds:
        this.syncDrainSecond === null ? null : Math.max(0, this.syncDrainSecond - recoveryFaultEnd),
      throughputPerMinute:
        this.durableOrders.size / Math.max(1 / 60, this.config.durationSeconds / 60),
      interactionLatencyMs: percentile(this.interactionLatencies),
      localCommitLatencyMs: percentile(this.localCommitLatencies),
      dashboardLagMs: percentile(this.dashboardLags),
      providerCallbackLatencyMs: percentile(this.providerCallbackLatencies),
      notificationDeliveryFailures: this.notificationDeliveryFailures,
      simulatedDependencyErrors: this.simulatedDependencyErrors,
      errorRate: this.simulatedDependencyErrors / operations,
      stockoutAttempts: this.stockoutAttempts,
      transfersCreated: this.transfersCreated,
      transfersCompleted: this.transfersCompleted,
      inventoryConverged,
      inventoryConvergenceSeconds:
        this.inventoryConvergenceSecond === null
          ? null
          : this.inventoryConvergenceSecond - this.config.durationSeconds,
      edgeCloudConverged,
    };
  }

  private assertions(metrics: SimulationMetrics): ReleaseAssertion[] {
    return [
      {
        id: 'LOCAL_DURABILITY',
        description: 'No locally committed order is lost under remote failure.',
        passed: metrics.lostCommittedOrders === 0,
        observed: `${metrics.lostCommittedOrders} lost of ${metrics.committedOrders} committed`,
      },
      {
        id: 'LOCAL_INTERACTION_P95',
        description: 'Modeled local interaction p95 remains below 150 ms.',
        passed: metrics.interactionLatencyMs.p95 < 150,
        observed: `${metrics.interactionLatencyMs.p95} ms`,
      },
      {
        id: 'LOCAL_COMMIT_P95',
        description: 'Modeled local commit p95 remains below 250 ms.',
        passed: metrics.localCommitLatencyMs.p95 < 250,
        observed: `${metrics.localCommitLatencyMs.p95} ms`,
      },
      {
        id: 'NO_DUPLICATE_BUSINESS_EFFECT',
        description:
          'Duplicate/reordered sync and provider signals never duplicate a business effect.',
        passed: metrics.duplicateBusinessEffects === 0,
        observed: `${metrics.duplicateBusinessEffects} duplicate effects from ${metrics.duplicateSyncDeliveries} duplicate sync deliveries and ${metrics.duplicateProviderSignals} duplicate provider signals`,
      },
      {
        id: 'SYNC_DRAINS',
        description: 'Offline sync backlog fully drains during the recovery window.',
        passed: metrics.syncBacklogAtEnd === 0,
        observed: `${metrics.syncBacklogAtEnd} events remain; max backlog ${metrics.maxSyncBacklog}`,
      },
      {
        id: 'PAYMENT_TRUTH_RESOLVES',
        description: 'Injected payment uncertainty resolves without creating another charge.',
        passed: metrics.unknownPaymentsAtEnd === 0,
        observed: `${metrics.unknownPaymentsAtEnd} unresolved at end from ${metrics.unknownPaymentsCreated} uncertain attempts`,
      },
      {
        id: 'PAYMENT_EFFECT_COUNT',
        description:
          'Every committed modeled sale has exactly one completed payment effect by recovery end.',
        passed: metrics.completedPayments === metrics.committedOrders,
        observed: `${metrics.completedPayments} completed payments for ${metrics.committedOrders} committed orders`,
      },
      {
        id: 'INVENTORY_CONVERGENCE',
        description: 'Physical, Edge and Cloud inventory converge after recovery.',
        passed: metrics.inventoryConverged,
        observed:
          metrics.inventoryConvergenceSeconds === null
            ? 'not converged'
            : `converged ${metrics.inventoryConvergenceSeconds}s after traffic stopped`,
      },
      {
        id: 'EDGE_CLOUD_CONVERGENCE',
        description: 'Cloud order/inventory projections converge to durable event truth.',
        passed: metrics.edgeCloudConverged,
        observed: metrics.edgeCloudConverged ? 'converged' : 'not converged',
      },
    ];
  }

  private posToEdgeAvailable(registerId: string, second: number): boolean {
    if (!this.edgeAvailable(second)) return false;
    return !(this.config.faults.posIsolations ?? []).some(
      (window) => window.registerIds.includes(registerId) && inWindow(second, window),
    );
  }

  private edgeAvailable(second: number): boolean {
    return !(this.config.faults.edgeRestartSeconds ?? []).some(
      (restart) => second >= restart && second <= restart + 2,
    );
  }

  private edgeToCloudAvailable(second: number): boolean {
    if (!this.edgeAvailable(second)) return false;
    const cloudDown = (this.config.faults.cloudOutages ?? []).some((window) =>
      inWindow(second, window),
    );
    const edgeCloudDown = (this.config.faults.edgeCloudOutages ?? []).some((window) =>
      inWindow(second, window),
    );
    const wanFailover = (this.config.faults.wanFailovers ?? []).some((window) =>
      inWindow(second, window),
    );
    return !(cloudDown || edgeCloudDown || wanFailover);
  }

  private inventoryEquals(left: Map<string, number>, right: Map<string, number>): boolean {
    const keys = new Set([...left.keys(), ...right.keys()]);
    for (const key of keys) {
      if ((left.get(key) ?? 0) !== (right.get(key) ?? 0)) return false;
    }
    return true;
  }
}
