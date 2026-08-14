import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PaymentsModule } from '../payments/payments.module';
import { CommandCentreController } from './command-centre.controller';
import { CommandCentreService } from './command-centre.service';

@Module({
  imports: [DatabaseModule, PaymentsModule],
  controllers: [CommandCentreController],
  providers: [CommandCentreService],
  exports: [CommandCentreService],
})
export class CommandCentreModule {}
