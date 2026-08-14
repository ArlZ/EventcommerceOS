import { Module } from '@nestjs/common';
import { CommandCentreModule } from './command-centre/command-centre.module';
import { ConfigurationModule } from './configuration/configuration.module';
import { DatabaseModule } from './database/database.module';
import { InventoryModule } from './inventory/inventory.module';
import { PaymentsModule } from './payments/payments.module';
import { SyncModule } from './sync/sync.module';
import { HealthModule } from './system/health.module';

@Module({
  imports: [
    DatabaseModule,
    HealthModule,
    ConfigurationModule,
    InventoryModule,
    PaymentsModule,
    SyncModule,
    CommandCentreModule,
  ],
})
export class AppModule {}
