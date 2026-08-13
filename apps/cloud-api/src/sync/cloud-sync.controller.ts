import { Body, Controller, Get, Inject, Post } from '@nestjs/common';
import type { EdgeCloudAck } from '@event-commerce/contracts';
import { CloudSyncService } from './cloud-sync.service';
import { parseEdgeBatch } from './sync-validation';

@Controller('sync')
export class CloudSyncController {
  constructor(@Inject(CloudSyncService) private readonly sync: CloudSyncService) {}

  @Post('edge-events')
  async ingest(@Body() body: unknown): Promise<EdgeCloudAck> {
    return this.sync.ingest(parseEdgeBatch(body));
  }

  @Get('devices')
  async devices() {
    return this.sync.deviceHealth();
  }
}
