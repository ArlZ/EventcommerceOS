import { Injectable } from '@nestjs/common';
import type { InventoryEdgeAck, InventoryEdgeBatch } from '@event-commerce/contracts';
import { edgeCloudHeaders } from '../security/edge-cloud-credential';
import { InventoryCloudTransport } from './inventory-cloud.transport';

function endpoint(): URL {
  const base = new URL(process.env.CLOUD_API_URL ?? 'http://127.0.0.1:3000');
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(base.hostname);
  if (base.protocol !== 'https:' && !loopback) {
    throw new Error(
      'inventory Edge-to-Cloud transport requires HTTPS outside loopback development',
    );
  }
  return new URL('/inventory/edge-events', base);
}

@Injectable()
export class HttpInventoryCloudTransport extends InventoryCloudTransport {
  async send(batch: InventoryEdgeBatch): Promise<InventoryEdgeAck> {
    const response = await fetch(endpoint(), {
      method: 'POST',
      headers: edgeCloudHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify(batch),
    });
    if (!response.ok) throw new Error(`inventory cloud sync failed with HTTP ${response.status}`);
    return (await response.json()) as InventoryEdgeAck;
  }
}
