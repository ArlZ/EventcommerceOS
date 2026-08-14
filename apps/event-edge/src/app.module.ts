import { Module } from '@nestjs/common';
import { EdgeDatabaseModule } from './database/database.module';
import { InventoryModule } from './inventory/inventory.module';
import { EdgePaymentsModule } from './payments/payments.module';
import { EdgeSecurityModule } from './security/security.module';
import { SyncModule } from './sync/sync.module';
import { HealthModule } from './system/health.module';

@Module({
  imports: [
    EdgeDatabaseModule,
    EdgeSecurityModule,
    HealthModule,
    InventoryModule,
    EdgePaymentsModule,
    SyncModule,
  ],
})
export class AppModule {}
