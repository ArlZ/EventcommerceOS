import { Module } from '@nestjs/common';
import { CloudSyncController } from './cloud-sync.controller';
import { CloudSyncService } from './cloud-sync.service';
import { EdgeCloudAuthService } from './edge-cloud-auth.service';
import { SyncDeviceHealthService } from './sync-device-health.service';

@Module({
  controllers: [CloudSyncController],
  providers: [CloudSyncService, EdgeCloudAuthService, SyncDeviceHealthService],
  exports: [EdgeCloudAuthService],
})
export class SyncModule {}
