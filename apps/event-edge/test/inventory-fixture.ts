import type { SyncEventEnvelope } from '@event-commerce/contracts';
import type { EdgeDatabaseService } from '../src/database/database.service';
import type { InventoryConfigurationService } from '../src/inventory/inventory-configuration.service';
import type { InventoryLedgerService } from '../src/inventory/inventory-ledger.service';

export const inventoryEventId = 'inventory-event';
export const mainLocationId = 'inventory-main';
export const warehouseLocationId = 'inventory-warehouse';
export const beerSkuId = 'sku-beer';
export const ginSkuId = 'sku-gin-ml';
export const tonicSkuId = 'sku-tonic';
export const cocktailSkuId = 'sku-gin-tonic';
export const operatorActorId = 'inventory-operator';
export const responsibleActorId = 'inventory-controller';
export const escalationActorId = 'inventory-manager';

export async function resetInventory(database: EdgeDatabaseService): Promise<void> {
  // Some inventory tests first persist device close events through Task 004 sync. The
  // sync outbox owns an FK to those processed events, so reset it before deleting the
  // sale-event rows. This preserves the production FK rather than weakening it for tests.
  await database.query(
    `DELETE FROM edge_cloud_outbox
     WHERE event_instance_id IN (
       SELECT event_instance_id FROM edge_processed_device_events
       WHERE device_id = 'device-inventory-test'
         AND event_type IN ('ORDER_CLOSED_CASH', 'ORDER_CLOSED_MPESA')
     )`,
  );
  await database.query(
    `TRUNCATE
       edge_inventory_sale_inbox,
       edge_inventory_notification_outbox,
       edge_inventory_alert_history,
       edge_inventory_alerts,
       edge_stock_count_lines,
       edge_stock_counts,
       edge_stock_transfer_receipts,
       edge_stock_transfer_history,
       edge_stock_transfer_lines,
       edge_stock_transfers,
       edge_inventory_exceptions,
       edge_inventory_cloud_outbox,
       edge_inventory_ledger,
       edge_inventory_actor_permissions,
       edge_inventory_responsibilities,
       edge_inventory_alert_config,
       edge_inventory_recipes,
       edge_sales_inventory_mapping,
       edge_inventory_skus,
       edge_inventory_locations,
       edge_inventory_event_config
     CASCADE`,
  );
  await database.query(
    `DELETE FROM edge_processed_device_events
     WHERE device_id = 'device-inventory-test'
       AND event_type IN ('ORDER_CLOSED_CASH', 'ORDER_CLOSED_MPESA')`,
  );
}

export async function installInventoryFixture(
  configuration: InventoryConfigurationService,
): Promise<void> {
  await configuration.install({
    eventId: inventoryEventId,
    eventEndAt: '2026-08-14T10:00:00.000Z',
    shortWindowMinutes: 10,
    mediumWindowMinutes: 30,
    shortWeightBasisPoints: 6000,
    escalationMinutes: 5,
    sourceActorId: 'inventory-admin',
    locations: [
      { id: mainLocationId, name: 'Main Bar', type: 'BAR_STORE' },
      { id: warehouseLocationId, name: 'Warehouse', type: 'WAREHOUSE' },
    ],
    skus: [
      { skuId: beerSkuId, name: 'Beer', category: 'BEER', baseUnit: 'each' },
      { skuId: ginSkuId, name: 'Gin', category: 'SPIRITS', baseUnit: 'ml' },
      { skuId: tonicSkuId, name: 'Tonic', category: 'MIXERS', baseUnit: 'each' },
      { skuId: cocktailSkuId, name: 'Gin & Tonic', category: 'COCKTAIL', baseUnit: 'each' },
    ],
    salesMappings: [
      { salesLocationId: 'bar-main', inventoryLocationId: mainLocationId },
      { salesLocationId: 'warehouse-sales', inventoryLocationId: warehouseLocationId },
    ],
    recipes: [
      { soldSkuId: cocktailSkuId, componentSkuId: ginSkuId, quantityPerSoldUnit: '50' },
      { soldSkuId: cocktailSkuId, componentSkuId: tonicSkuId, quantityPerSoldUnit: '1' },
    ],
    alertConfigs: [
      {
        id: 'alert-main-beer',
        inventoryLocationId: mainLocationId,
        skuId: beerSkuId,
        absoluteMinimum: '40',
        minutesCoverThreshold: 15,
        targetCoverMinutes: 60,
        sourceSafetyStock: '20',
        eventWideSafetyStock: '50',
        imbalanceRatio: 2,
      },
    ],
    responsibilities: [
      {
        inventoryLocationId: mainLocationId,
        actorId: responsibleActorId,
        escalationActorId,
      },
    ],
    permissions: [
      { actorId: operatorActorId, permission: 'MANUAL_MOVEMENT' },
      { actorId: operatorActorId, permission: 'TRANSFER_CREATE' },
      { actorId: operatorActorId, permission: 'TRANSFER_ASSIGN' },
      { actorId: operatorActorId, permission: 'TRANSFER_PICK' },
      { actorId: operatorActorId, permission: 'TRANSFER_DISPATCH' },
      { actorId: operatorActorId, permission: 'TRANSFER_RECEIVE' },
      { actorId: operatorActorId, permission: 'TRANSFER_CANCEL' },
      { actorId: operatorActorId, permission: 'COUNT_START' },
      { actorId: operatorActorId, permission: 'COUNT_CLOSE' },
      { actorId: responsibleActorId, permission: 'ALERT_ACKNOWLEDGE' },
      { actorId: responsibleActorId, permission: 'ALERT_ASSIGN' },
      { actorId: escalationActorId, permission: 'ALERT_RESOLVE' },
    ],
  });
}

export async function receipt(
  ledger: InventoryLedgerService,
  inventoryLocationId: string,
  skuId: string,
  quantity: bigint,
  suffix: string,
): Promise<void> {
  await ledger.postManual({
    eventId: inventoryEventId,
    inventoryLocationId,
    skuId,
    movementType: 'RECEIVE',
    quantityDeltaBase: quantity.toString(),
    sourceType: 'RECEIPT',
    sourceId: `receipt-${suffix}`,
    actorId: operatorActorId,
    reason: 'test receipt',
    occurredAt: '2026-08-14T07:50:00.000Z',
    idempotencyKey: `receipt-${suffix}`,
  });
}

export function closedSale(overrides: {
  eventInstanceId?: string;
  eventType?: 'ORDER_CLOSED_CASH' | 'ORDER_CLOSED_MPESA';
  orderId?: string;
  occurredAt?: string;
  lines: Array<{ skuId: string; quantity: number }>;
}): SyncEventEnvelope {
  const eventInstanceId = overrides.eventInstanceId ?? 'inventory-sale-event-001';
  return {
    eventInstanceId,
    eventId: `inventory-sync-${eventInstanceId}`,
    eventType: overrides.eventType ?? 'ORDER_CLOSED_CASH',
    aggregateType: 'ORDER',
    aggregateId: overrides.orderId ?? `order-${eventInstanceId}`,
    eventVersion: 2,
    deviceId: 'device-inventory-test',
    sequence: 1,
    occurredAt: overrides.occurredAt ?? '2026-08-14T08:00:00.000Z',
    idempotencyKey: `sale:${eventInstanceId}`,
    payload: {
      eventId: inventoryEventId,
      salesLocationId: 'bar-main',
      orderId: overrides.orderId ?? `order-${eventInstanceId}`,
      state: 'CLOSED',
      totalMinor: 1000,
      currency: 'KES',
      lines: overrides.lines,
    },
  };
}
