import { Module } from '@nestjs/common';
import { CloudSyncController } from './cloud-sync.controller';
import { CloudSyncService } from './cloud-sync.service';
import { EdgeSyncAuthService } from './edge-sync-auth.service';

@Module({
  controllers: [CloudSyncController],
  providers: [CloudSyncService, EdgeSyncAuthService],
})
export class SyncModule {}
