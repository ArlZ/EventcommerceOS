import { Injectable } from '@nestjs/common';
import type { EdgeCloudAck, EdgeCloudBatch } from '@event-commerce/contracts';
import { CloudSyncTransport } from './cloud-sync.transport';

@Injectable()
export class HttpCloudSyncTransport extends CloudSyncTransport {
  async send(batch: EdgeCloudBatch): Promise<EdgeCloudAck> {
    const url = process.env.CLOUD_SYNC_URL ?? 'http://localhost:3001/sync/edge-events';
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(batch),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`cloud sync returned HTTP ${response.status}`);
    return (await response.json()) as EdgeCloudAck;
  }
}
