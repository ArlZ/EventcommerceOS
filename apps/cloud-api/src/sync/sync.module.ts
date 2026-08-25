import { Module } from '@nestjs/common';
import { CloudSyncController } from './cloud-sync.controller';
import { CloudSyncService } from './cloud-sync.service';
import { EdgeCloudAuthService } from './edge-cloud-auth.service';
import { PosMenuInstallReceiptService } from './pos-menu-install-receipt.service';
import { PosMenuPublicationController } from './pos-menu-publication.controller';
import { PosMenuPublicationService } from './pos-menu-publication.service';
import { SyncDeviceHealthService } from './sync-device-health.service';

@Module({
  controllers: [CloudSyncController, PosMenuPublicationController],
  providers: [
    CloudSyncService,
    EdgeCloudAuthService,
    PosMenuInstallReceiptService,
    PosMenuPublicationService,
    SyncDeviceHealthService,
  ],
  exports: [EdgeCloudAuthService],
})
export class SyncModule {}
