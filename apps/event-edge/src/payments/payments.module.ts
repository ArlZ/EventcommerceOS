import { Module } from '@nestjs/common';
import { EdgeDatabaseModule } from '../database/database.module';
import { EdgePaymentsController } from './payments.controller';
import { EdgePaymentsService } from './payments.service';

@Module({
  imports: [EdgeDatabaseModule],
  controllers: [EdgePaymentsController],
  providers: [EdgePaymentsService],
  exports: [EdgePaymentsService],
})
export class EdgePaymentsModule {}
