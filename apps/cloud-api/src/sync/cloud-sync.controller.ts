import { Body, Controller, Headers, Inject, Post } from '@nestjs/common';
import type { EdgeCloudAck } from '@event-commerce/contracts';
import { CloudSyncService } from './cloud-sync.service';
import { EdgeSyncAuthService } from './edge-sync-auth.service';
import { parseEdgeBatch } from './sync-validation';

type HeadersRecord = Record<string, string | string[] | undefined>;

@Controller('sync')
export class CloudSyncController {
  constructor(
    @Inject(CloudSyncService) private readonly sync: CloudSyncService,
    @Inject(EdgeSyncAuthService) private readonly edgeAuth: EdgeSyncAuthService,
  ) {}

  @Post('edge-events')
  async ingest(
    @Headers() headers: HeadersRecord,
    @Body() body: unknown,
  ): Promise<EdgeCloudAck> {
    const identity = await this.edgeAuth.authenticate(headers);
    const batch = parseEdgeBatch(body);
    await this.edgeAuth.authorizeBatch(identity, batch);
    return this.sync.ingest(batch, identity);
  }
}
