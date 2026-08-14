import {
  MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { HumanContextMiddleware } from './auth/human-context.middleware';
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
    AuthModule,
    HealthModule,
    ConfigurationModule,
    InventoryModule,
    PaymentsModule,
    SyncModule,
    CommandCentreModule,
    EventCloseModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HumanContextMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
