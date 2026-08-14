import { Module } from '@nestjs/common';
import { OperatorAuthModule } from './auth/operator-auth.module';
import { CommandCentreModule } from './command-centre/command-centre.module';
import { ConfigurationModule } from './configuration/configuration.module';
import { DatabaseModule } from './database/database.module';
import { EventCloseModule } from './event-close/event-close.module';
import { InventoryModule } from './inventory/inventory.module';
import { PaymentsModule } from './payments/payments.module';
import { SyncModule } from './sync/sync.module';
import { HealthModule } from './system/health.module';

@Module({
  imports: [
    DatabaseModule,
    OperatorAuthModule,
    HealthModule,
    ConfigurationModule,
    InventoryModule,
    PaymentsModule,
    SyncModule,
    CommandCentreModule,
    EventCloseModule,
  ],
})
export class AppModule {}
