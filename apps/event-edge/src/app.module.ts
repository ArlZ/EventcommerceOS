import { Module } from '@nestjs/common';
import { EdgeDatabaseModule } from './database/database.module';
import { SyncModule } from './sync/sync.module';
import { HealthModule } from './system/health.module';

@Module({ imports: [EdgeDatabaseModule, HealthModule, SyncModule] })
export class AppModule {}
