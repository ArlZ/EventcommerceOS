import { Module } from '@nestjs/common';
import { EdgeDatabaseModule } from './database/database.module';
import { InventoryModule } from './inventory/inventory.module';
import { PaymentModule } from './payments/payment.module';
import { SyncModule } from './sync/sync.module';
import { HealthModule } from './system/health.module';

@Module({ imports: [EdgeDatabaseModule, HealthModule, InventoryModule, PaymentModule, SyncModule] })
export class AppModule {}
