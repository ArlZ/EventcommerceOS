import { Module } from '@nestjs/common';
import { HealthModule } from './system/health.module';

@Module({ imports: [HealthModule] })
export class AppModule {}
