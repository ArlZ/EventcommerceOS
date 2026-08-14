import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { EventCloseController } from './event-close.controller';
import { EventCloseLedgerService } from './event-close-ledger.service';
import { EventCloseReportService } from './event-close-report.service';
import { EventCloseService } from './event-close.service';

@Module({
  imports: [DatabaseModule],
  controllers: [EventCloseController],
  providers: [EventCloseLedgerService, EventCloseReportService, EventCloseService],
  exports: [EventCloseService],
})
export class EventCloseModule {}
