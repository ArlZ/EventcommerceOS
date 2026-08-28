import type { PaymentRailAvailabilityView } from './payment';

export interface CommandCentreCurrencyAmount {
  currency: string;
  amountMinor: string;
}

export interface CommandCentreCurrencyAverage {
  currency: string;
  averageOrderValueMinor: string;
}

export interface CommandCentreCurrencyVelocity {
  currency: string;
  amountMinorPerMinute: string;
}

export interface CommandCentreSalesPulsePoint {
  bucketStart: string;
  transactionCount: number;
  grossSales: CommandCentreCurrencyAmount[];
}

export interface CommandCentreSalesSummary {
  transactionCount: number;
  grossSales: CommandCentreCurrencyAmount[];
  averageOrderValue: CommandCentreCurrencyAverage[];
  currentSalesVelocity: CommandCentreCurrencyVelocity[];
  lastSaleAt: string | null;
}

export interface CommandCentreLocationMetric {
  salesLocationId: string;
  name: string;
  transactionCount: number;
  grossSales: CommandCentreCurrencyAmount[];
  currentSalesVelocity: CommandCentreCurrencyVelocity[];
  lastSaleAt: string | null;
  paymentSuccessRate: number | null;
  tillsHealthy: number;
  tillsTotal: number;
  lowestCoverMinutes: number | null;
  issueCount: number;
}

export interface CommandCentreProductMetric {
  skuId: string;
  name: string;
  quantitySold: string;
  grossSales: CommandCentreCurrencyAmount[];
}

export interface CommandCentrePaymentMethodMetric {
  providerId: string;
  currency: string;
  transactionCount: number;
  valueMinor: string;
}

export interface CommandCentrePaymentAttemptHealth {
  totalCount: number;
  succeededCount: number;
  pendingCount: number;
  unknownCount: number;
  failedCount: number;
  successRate: number;
  pendingRate: number;
  unknownRate: number;
  failureRate: number;
  unknownValue: CommandCentreCurrencyAmount[];
}

export interface CommandCentreInventoryRisk {
  alertId: string;
  alertType: string;
  severity: string;
  state: string;
  inventoryLocationId: string | null;
  inventoryLocationName: string | null;
  skuId: string;
  skuName: string;
  availableQuantityBase: string;
  minutesOfCover: string | null;
  suggestedSourceLocationId: string | null;
  suggestedSourceLocationName: string | null;
  suggestedTransferQuantityBase: string | null;
  responsibleActorId: string | null;
  assignedActorId: string | null;
  openedAt: string;
}

export interface CommandCentreTransferMetric {
  transferId: string;
  sourceLocationId: string;
  sourceLocationName: string | null;
  destinationLocationId: string;
  destinationLocationName: string | null;
  state: string;
  assignedActorId: string | null;
  updatedAt: string;
}

export interface CommandCentreDeviceMetric {
  deviceId: string;
  salesLocationId: string | null;
  salesLocationName: string | null;
  lastSeenAt: string | null;
  lastCloudDeliveryAt: string | null;
  edgeBacklogCount: number;
  syncAgeSeconds: number | null;
  status: 'HEALTHY' | 'DEGRADED' | 'STALE';
  transactionCount?: number;
  grossSales?: CommandCentreCurrencyAmount[];
  currentSalesVelocity?: CommandCentreCurrencyVelocity[];
}

export type CommandCentreAlertSource = 'INVENTORY' | 'PAYMENT' | 'DEVICE';
export type CommandCentreAlertSeverity = 'CRITICAL' | 'URGENT' | 'WARNING' | 'INFO';

export interface CommandCentreAlert {
  id: string;
  source: CommandCentreAlertSource;
  severity: CommandCentreAlertSeverity;
  state: string;
  title: string;
  detail: string;
  openedAt: string;
  inventoryAlertId: string | null;
  actionable: boolean;
  assignedActorId: string | null;
}

export interface CommandCentreSnapshot {
  event: {
    eventId: string;
    organisationId: string;
    name: string;
    timezone: string;
    lifecycle: string;
    startsAt: string;
    endsAt: string;
  };
  freshness: {
    generatedAt: string;
    staleAfterSeconds: number;
    latestSourceAt: string | null;
  };
  sales: CommandCentreSalesSummary;
  salesPulse: CommandCentreSalesPulsePoint[];
  salesLocations: CommandCentreLocationMetric[];
  topProducts: CommandCentreProductMetric[];
  payments: {
    settledMethods: CommandCentrePaymentMethodMetric[];
    attempts: CommandCentrePaymentAttemptHealth;
    rails: PaymentRailAvailabilityView[];
  };
  inventory: {
    risks: CommandCentreInventoryRisk[];
    activeTransfers: CommandCentreTransferMetric[];
  };
  devices: CommandCentreDeviceMetric[];
  alerts: CommandCentreAlert[];
}

export interface CommandCentreRealtimeEvent {
  eventId: string;
  serverTime: string;
  versionToken: string;
}

export type CommandCentreInventoryAlertAction = 'ACKNOWLEDGE' | 'ASSIGN';

export interface CommandCentreInventoryAlertActionRequest {
  action: CommandCentreInventoryAlertAction;
  assignedActorId?: string;
}

export interface CommandCentreInventoryAlertActionView {
  auditId: string;
  alertId: string;
  eventId: string;
  action: CommandCentreInventoryAlertAction;
  previousState: string;
  resultingState: string;
  actorId: string;
  assignedActorId: string | null;
  createdAt: string;
}
