import { Module } from '@nestjs/common';
import { EdgeDatabaseService } from '../database/database.service';
import { InventoryModule } from '../inventory/inventory.module';
import { CloudForwarderService } from './cloud-forwarder.service';
import { CloudSyncTransport } from './cloud-sync.transport';
import { DeviceSyncController } from './device-sync.controller';
import { DeviceSyncService } from './device-sync.service';
import { HttpCloudSyncTransport } from './http-cloud-sync.transport';

@Module({
  imports: [InventoryModule],
  controllers: [DeviceSyncController],
  providers: [
    { provide: CloudSyncTransport, useClass: HttpCloudSyncTransport },
    {
      provide: DeviceSyncService,
      useFactory: (database: EdgeDatabaseService) => new DeviceSyncService(database),
      inject: [EdgeDatabaseService],
    },
    {
      provide: CloudForwarderService,
      useFactory: (database: EdgeDatabaseService, transport: CloudSyncTransport) =>
        new CloudForwarderService(database, transport),
      inject: [EdgeDatabaseService, CloudSyncTransport],
    },
  ],
  exports: [DeviceSyncService, CloudForwarderService],
})
export class SyncModule {}
