import { Injectable } from '@nestjs/common';
import type { EdgeCloudAck, EdgeCloudBatch } from '@event-commerce/contracts';
import { edgeCloudHeaders } from '../security/edge-cloud-credential';
import { CloudSyncTransport } from './cloud-sync.transport';

@Injectable()
export class HttpCloudSyncTransport extends CloudSyncTransport {
  async send(batch: EdgeCloudBatch): Promise<EdgeCloudAck> {
    const url = process.env.CLOUD_SYNC_URL ?? 'http://localhost:3001/sync/edge-events';
    const parsed = new URL(url);
    const loopback =
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '::1';
    if (parsed.protocol !== 'https:' && !loopback) {
      throw new Error('cloud sync URL must use HTTPS outside loopback development');
    }
    const response = await fetch(url, {
      method: 'POST',
      headers: edgeCloudHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify(batch),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`cloud sync returned HTTP ${response.status}`);
    return (await response.json()) as EdgeCloudAck;
  }
}
