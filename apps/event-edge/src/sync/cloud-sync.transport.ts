import type { EdgeCloudAck, EdgeCloudBatch } from '@event-commerce/contracts';

export abstract class CloudSyncTransport {
  abstract send(batch: EdgeCloudBatch): Promise<EdgeCloudAck>;
}
