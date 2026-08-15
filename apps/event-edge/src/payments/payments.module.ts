import { Module } from '@nestjs/common';
import { EdgeDatabaseModule } from '../database/database.module';
import { EdgePaymentsController } from './payments.controller';
import { EdgePaymentsService } from './payments.service';
import { TerminalPaymentsService } from './terminal-payments.service';

@Module({
  imports: [EdgeDatabaseModule],
  controllers: [EdgePaymentsController],
  providers: [EdgePaymentsService, TerminalPaymentsService],
  exports: [EdgePaymentsService, TerminalPaymentsService],
})
export class EdgePaymentsModule {}
