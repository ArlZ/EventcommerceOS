import { Module } from '@nestjs/common';
import { ConfigurationModule } from './configuration/configuration.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './system/health.module';

@Module({
  imports: [DatabaseModule, HealthModule, ConfigurationModule],
})
export class AppModule {}
