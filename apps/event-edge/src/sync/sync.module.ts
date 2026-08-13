import { Module } from '@nestjs/common';
import { CloudForwarderService } from './cloud-forwarder.service';
import { CloudSyncTransport } from './cloud-sync.transport';
import { DeviceSyncController } from './device-sync.controller';
import { DeviceSyncService } from './device-sync.service';
import { HttpCloudSyncTransport } from './http-cloud-sync.transport';

@Module({
  controllers: [DeviceSyncController],
  providers: [
    DeviceSyncService,
    CloudForwarderService,
    { provide: CloudSyncTransport, useClass: HttpCloudSyncTransport },
  ],
  exports: [DeviceSyncService, CloudForwarderService],
})
export class SyncModule {}
