import { Body, Controller, Headers, Inject, Post } from '@nestjs/common';
import type { EdgeCloudAck } from '@event-commerce/contracts';
import { CloudSyncService } from './cloud-sync.service';
import { EdgeCloudAuthService } from './edge-cloud-auth.service';
import { parseEdgeBatch } from './sync-validation';

type HeadersRecord = Record<string, string | string[] | undefined>;

@Controller('sync')
export class CloudSyncController {
  constructor(
    @Inject(CloudSyncService) private readonly sync: CloudSyncService,
    @Inject(EdgeCloudAuthService) private readonly edgeAuth: EdgeCloudAuthService,
  ) {}

  @Post('edge-events')
  async ingest(
    @Headers() headers: HeadersRecord,
    @Body() body: unknown,
  ): Promise<EdgeCloudAck> {
    const identity = await this.edgeAuth.authenticate(headers);
    const batch = parseEdgeBatch(body);
    await this.edgeAuth.authorizeSyncBatch(identity, batch);
    return this.sync.ingest(batch, identity);
  }
}
