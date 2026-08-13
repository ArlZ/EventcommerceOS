import { Body, Controller, Inject, Post } from '@nestjs/common';
import type { DeviceSyncAck } from '@event-commerce/contracts';
import { SafeDeviceSyncService } from './safe-device-sync.service';
import { parseDeviceBatch } from './sync-validation';

@Controller('sync')
export class DeviceSyncController {
  constructor(@Inject(SafeDeviceSyncService) private readonly sync: SafeDeviceSyncService) {}

  @Post('device-events')
  async ingest(@Body() body: unknown): Promise<DeviceSyncAck> {
    return this.sync.ingest(parseDeviceBatch(body));
  }
}
