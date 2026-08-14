export interface InventoryEdgeEvent {
  id: string;
  eventType:
    | 'INVENTORY_CONFIGURATION_INSTALLED'
    | 'INVENTORY_LEDGER_POSTED'
    | 'INVENTORY_TRANSFER_UPSERTED'
    | 'INVENTORY_COUNT_CLOSED'
    | 'INVENTORY_ALERT_UPSERTED';
  aggregateType:
    | 'INVENTORY_EVENT'
    | 'STOCK_LEDGER_ENTRY'
    | 'STOCK_TRANSFER'
    | 'STOCK_COUNT'
    | 'INVENTORY_ALERT';
  aggregateId: string;
  payload: Record<string, unknown>;
}

export interface InventoryEdgeBatch {
  edgeId: string;
  events: InventoryEdgeEvent[];
}

export interface InventoryEdgeAck {
  acceptedIds: string[];
  duplicateIds: string[];
  conflictIds: string[];
  serverTime: string;
}
