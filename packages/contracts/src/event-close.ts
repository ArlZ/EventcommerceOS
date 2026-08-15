export type EventCloseState = 'OPEN' | 'OPERATIONALLY_CLOSED' | 'REOPENED';

export interface EventCloseMoney {
  currency: string;
  amountMinor: string;
}

export interface EventCloseSalesSummary {
  grossSales: EventCloseMoney[];
  discounts: EventCloseMoney[];
  comps: EventCloseMoney[];
  voids: EventCloseMoney[];
  refunds: EventCloseMoney[];
  netSales: EventCloseMoney[];
}

export interface EventClosePaymentMethodSummary {
  methodId: string;
  currency: string;
  succeededCount: number;
  grossTenderMinor: string;
  refundMinor: string;
  reversalMinor: string;
  netTenderMinor: string;
  unresolvedAttemptCount: number;
}

export interface EventCloseProviderReconciliation {
  providerId: string;
  currency: string;
  succeededCount: number;
  succeededValueMinor: string;
  pendingCount: number;
  unknownCount: number;
  failedCount: number;
  unknownValueMinor: string;
  adjustmentUnknownCount: number;
  transactionReconciliationStatus: 'RECONCILED' | 'UNRESOLVED';
  settlementStatus: 'PROVIDER_SETTLEMENT_DATA_UNAVAILABLE';
}

export interface EventCloseCashScope {
  salesLocationId: string;
  salesLocationName: string | null;
  deviceId: string;
  cashierId: string;
  currency: string;
  expectedMinor: string;
  declaredMinor: string | null;
  varianceMinor: string | null;
  declarationStatus: 'DECLARED' | 'MISSING';
  declarationId: string | null;
  declaredAt: string | null;
}

export interface EventCloseCashSummary {
  currency: string;
  expectedMinor: string;
  declaredMinor: string | null;
  varianceMinor: string | null;
  declarationStatus: 'COMPLETE' | 'PARTIAL' | 'MISSING';
}

export interface EventCloseInventoryVariance {
  inventoryLocationId: string;
  inventoryLocationName: string | null;
  skuId: string;
  skuName: string;
  expectedQuantityBase: string;
  physicalQuantityBase: string;
  varianceQuantityBase: string;
  unitCostMinor: string | null;
  valuationCurrency: string | null;
  varianceValueMinor: string | null;
  valuationStatus: 'VALUED' | 'MISSING_UNIT_COST';
  countId: string;
  countClosedAt: string | null;
}

export interface EventCloseUnresolvedPayment {
  paymentAttemptId: string;
  paymentId: string;
  orderId: string;
  providerId: string;
  amountMinor: string;
  currency: string;
  status: 'CREATED' | 'INITIATED' | 'PENDING' | 'UNKNOWN';
  providerReference: string | null;
  failureCode: string | null;
  reconciliationStatus: string | null;
  reconciliationErrorCode: string | null;
  updatedAt: string;
}

export interface EventCloseOpenTransfer {
  transferId: string;
  sourceLocationId: string;
  destinationLocationId: string;
  state: string;
  assignedActorId: string | null;
  lines: unknown[];
  updatedAt: string;
}

export interface EventCloseCriticalAlert {
  alertId: string;
  alertType: string;
  state: string;
  inventoryLocationId: string | null;
  skuId: string;
  availableQuantityBase: string;
  minutesOfCover: string | null;
  assignedActorId: string | null;
  openedAt: string;
}

export interface EventCloseDrilldown {
  dimensionType: 'SALES_LOCATION' | 'DEVICE' | 'CASHIER';
  dimensionId: string;
  dimensionName: string | null;
  currency: string;
  transactionCount: number;
  grossSalesMinor: string;
  discountMinor: string;
  compMinor: string;
  voidMinor: string;
  refundMinor: string;
  netSalesMinor: string;
}

export interface EventCloseFinancialReconciliation {
  currency: string;
  netSalesMinor: string;
  electronicNetTenderMinor: string;
  cashExpectedMinor: string;
  accountedTenderMinor: string;
  salesToTenderVarianceMinor: string;
  conclusive: boolean;
}

export interface EventCloseReport {
  event: {
    eventId: string;
    organisationId: string;
    name: string;
    timezone: string;
    lifecycle: string;
  };
  close: {
    state: EventCloseState;
    lastActionAt: string | null;
    lastClosedAt: string | null;
    lastClosedRevision: number | null;
    lastClosedReportId: string | null;
    sourceVersionAtLastClose: string | null;
    sourceChangedSinceLastClose: boolean;
  };
  generatedAt: string;
  sourceVersionToken: string;
  sales: EventCloseSalesSummary;
  paymentMethods: EventClosePaymentMethodSummary[];
  providerReconciliation: EventCloseProviderReconciliation[];
  cash: {
    summary: EventCloseCashSummary[];
    scopes: EventCloseCashScope[];
  };
  inventoryVariances: EventCloseInventoryVariance[];
  unresolvedPayments: EventCloseUnresolvedPayment[];
  openTransfers: EventCloseOpenTransfer[];
  unresolvedCriticalAlerts: EventCloseCriticalAlert[];
  drilldowns: EventCloseDrilldown[];
  financialReconciliation: EventCloseFinancialReconciliation[];
}

export type CommerceOrderAdjustmentKind = 'DISCOUNT' | 'COMP' | 'VOID' | 'CASH_REFUND';

export interface RecordCommerceOrderAdjustmentRequest {
  adjustmentId: string;
  orderId: string;
  kind: CommerceOrderAdjustmentKind;
  amountMinor: number;
  currency: string;
  reason: string;
  idempotencyKey: string;
}

export interface CommerceOrderAdjustmentView {
  adjustmentId: string;
  eventId: string;
  orderId: string;
  kind: CommerceOrderAdjustmentKind;
  amountMinor: string;
  currency: string;
  actorId: string;
  deviceId: string | null;
  cashierId: string | null;
  reason: string;
  idempotencyKey: string;
  createdAt: string;
}

export interface DeclareEventCashRequest {
  declarationId: string;
  salesLocationId: string;
  deviceId?: string;
  cashierId?: string;
  currency: string;
  declaredMinor: number;
  reason: string;
  idempotencyKey: string;
}

export interface EventCashDeclarationView {
  declarationId: string;
  eventId: string;
  salesLocationId: string;
  deviceId: string | null;
  cashierId: string | null;
  currency: string;
  declaredMinor: string;
  actorId: string;
  reason: string;
  idempotencyKey: string;
  declaredAt: string;
}

export interface DeclareInventoryUnitCostRequest {
  declarationId: string;
  skuId: string;
  currency: string;
  unitCostMinor: number;
  reason: string;
  idempotencyKey: string;
}

export interface InventoryUnitCostDeclarationView {
  declarationId: string;
  eventId: string;
  skuId: string;
  currency: string;
  unitCostMinor: string;
  actorId: string;
  reason: string;
  idempotencyKey: string;
  declaredAt: string;
}

export interface EventCloseActionRequest {
  actionId: string;
  reason: string;
}

export interface EventCloseActionView {
  actionId: string;
  eventId: string;
  action: 'OPERATIONALLY_CLOSE' | 'REOPEN';
  actorId: string;
  reason: string;
  reportId: string | null;
  closeRevision: number | null;
  createdAt: string;
}

export interface EventCloseStoredReportView {
  reportId: string;
  eventId: string;
  revision: number;
  sourceVersionToken: string;
  sha256: string;
  createdByActorId: string;
  createdAt: string;
  report: EventCloseReport;
}
