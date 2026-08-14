import { Module } from '@nestjs/common';
import { EdgeDatabaseModule } from '../database/database.module';
import { DeviceEdgeAuthModule } from '../security/device-edge-auth.module';
import { EdgePaymentsController } from './payments.controller';
import { EdgePaymentsService } from './payments.service';
import { TerminalPaymentsService } from './terminal-payments.service';

@Module({
  imports: [EdgeDatabaseModule, DeviceEdgeAuthModule],
  controllers: [EdgePaymentsController],
  providers: [EdgePaymentsService, TerminalPaymentsService],
  exports: [EdgePaymentsService, TerminalPaymentsService],
})
export class EdgePaymentsModule {}
