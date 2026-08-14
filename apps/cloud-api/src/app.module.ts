import { Module } from '@nestjs/common';
import { ConfigurationModule } from './configuration/configuration.module';
import { DatabaseModule } from './database/database.module';
import { InventoryModule } from './inventory/inventory.module';
import { PaymentModule } from './payments/payment.module';
import { SyncModule } from './sync/sync.module';
import { HealthModule } from './system/health.module';

@Module({
  imports: [
    DatabaseModule,
    HealthModule,
    ConfigurationModule,
    InventoryModule,
    PaymentModule,
    SyncModule,
  ],
})
export class AppModule {}
