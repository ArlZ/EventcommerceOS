import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { EventCloseCashCountService } from './event-close-cash-count.service';
import { EventCloseController } from './event-close.controller';
import { EventCloseLedgerService } from './event-close-ledger.service';
import { EventCloseReportService } from './event-close-report.service';
import { EventCloseService } from './event-close.service';

@Module({
  imports: [DatabaseModule],
  controllers: [EventCloseController],
  providers: [
    EventCloseCashCountService,
    EventCloseLedgerService,
    EventCloseReportService,
    EventCloseService,
  ],
  exports: [EventCloseService],
})
export class EventCloseModule {}
