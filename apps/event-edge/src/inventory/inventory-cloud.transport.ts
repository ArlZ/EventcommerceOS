import type { InventoryEdgeAck, InventoryEdgeBatch } from '@event-commerce/contracts';

export abstract class InventoryCloudTransport {
  abstract send(batch: InventoryEdgeBatch): Promise<InventoryEdgeAck>;
}
