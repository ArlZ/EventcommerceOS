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
     WHERE device_id = 'device-inventory-test' AND event_type = 'ORDER_CLOSED_CASH'`,
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
      {
        id: 'alert-warehouse-beer',
        inventoryLocationId: warehouseLocationId,
        skuId: beerSkuId,
        absoluteMinimum: '80',
        minutesCoverThreshold: 20,
        targetCoverMinutes: 90,
        sourceSafetyStock: '80',
        eventWideSafetyStock: '50',
        imbalanceRatio: 2,
      },
      {
        id: 'alert-event-beer',
        skuId: beerSkuId,
        absoluteMinimum: '0',
        minutesCoverThreshold: 15,
        targetCoverMinutes: 60,
        sourceSafetyStock: '0',
        eventWideSafetyStock: '50',
        imbalanceRatio: 2,
      },
    ],
    responsibilities: [
      {
        id: 'responsibility-main',
        inventoryLocationId: mainLocationId,
        responsibleActorId,
        escalationActorId,
        priority: 10,
      },
      {
        id: 'responsibility-event',
        responsibleActorId,
        escalationActorId,
        priority: 100,
      },
    ],
    permissions: [
      { actorId: operatorActorId, permission: 'INVENTORY_MOVE' },
      { actorId: operatorActorId, permission: 'TRANSFER_MANAGE' },
      { actorId: operatorActorId, permission: 'COUNT_MANAGE' },
      { actorId: operatorActorId, permission: 'ALERT_MANAGE' },
    ],
  });
}

export async function receipt(
  ledger: InventoryLedgerService,
  locationId: string,
  skuId: string,
  quantity: bigint,
  suffix: string,
  occurredAt = '2026-08-14T07:00:00.000Z',
): Promise<void> {
  await ledger.postManual({
    id: `receipt-${suffix}`,
    eventId: inventoryEventId,
    inventoryLocationId: locationId,
    skuId,
    movementType: 'RECEIPT',
    quantityDeltaBase: quantity.toString(),
    actorId: operatorActorId,
    reason: 'test receipt',
    occurredAt,
    idempotencyKey: `receipt-${suffix}`,
  });
}

export function closedSale(options: {
  eventInstanceId: string;
  salesLocationId?: string;
  occurredAt?: string;
  lines: Array<{ skuId: string; quantity: number }>;
}): SyncEventEnvelope {
  return {
    schemaVersion: 1,
    eventInstanceId: options.eventInstanceId,
    eventId: `event-${options.eventInstanceId}`,
    eventType: 'ORDER_CLOSED_CASH',
    aggregateType: 'ORDER',
    aggregateId: `order-${options.eventInstanceId}`,
    eventVersion: 2,
    deviceId: 'device-inventory-test',
    sequence: Number(options.eventInstanceId.replace(/\D/g, '').slice(-6) || '1'),
    occurredAt: options.occurredAt ?? '2026-08-14T07:55:00.000Z',
    idempotencyKey: `idem-${options.eventInstanceId}`,
    payload: {
      orderId: `order-${options.eventInstanceId}`,
      eventId: inventoryEventId,
      salesLocationId: options.salesLocationId ?? 'bar-main',
      state: 'CLOSED',
      totalMinor: 10_000,
      currency: 'KES',
      lines: options.lines.map((line) => ({
        menuItemId: `menu-${line.skuId}`,
        skuId: line.skuId,
        quantity: line.quantity,
        unitPriceMinor: 10_000,
      })),
    },
  };
}
