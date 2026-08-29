import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PaymentsModule } from '../payments/payments.module';
import { CommandCentreDeviceRosterService } from './command-centre-device-roster.service';
import { CommandCentreDeviceSalesService } from './command-centre-device-sales.service';
import { CommandCentreController } from './command-centre.controller';
import { CommandCentreService } from './command-centre.service';

@Module({
  imports: [DatabaseModule, PaymentsModule],
  controllers: [CommandCentreController],
  providers: [
    CommandCentreService,
    CommandCentreDeviceRosterService,
    CommandCentreDeviceSalesService,
  ],
  exports: [CommandCentreService],
})
export class CommandCentreModule {}
