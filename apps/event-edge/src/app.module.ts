import { Module } from '@nestjs/common';
import { EdgeDatabaseModule } from './database/database.module';
import { InventoryModule } from './inventory/inventory.module';
import { SyncModule } from './sync/sync.module';
import { HealthModule } from './system/health.module';

@Module({ imports: [EdgeDatabaseModule, HealthModule, InventoryModule, SyncModule] })
export class AppModule {}
