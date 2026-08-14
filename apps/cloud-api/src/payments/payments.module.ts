import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SyncModule } from '../sync/sync.module';
import { ExternalTerminalProvider } from './external-terminal.provider';
import { ManualTerminalService } from './manual-terminal.service';
import { MpesaProvider } from './mpesa.provider';
import { PaymentAdjustmentsService } from './payment-adjustments.service';
import { PaymentMachineAuthService } from './payment-machine-auth.service';
import { PAYMENT_PROVIDERS } from './payment-provider';
import { PaymentRailService } from './payment-rail.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PesapalSabiProvider } from './pesapal-sabi.provider';

@Module({
  imports: [DatabaseModule, SyncModule],
  controllers: [PaymentsController],
  providers: [
    MpesaProvider,
    PesapalSabiProvider,
    ExternalTerminalProvider,
    {
      provide: PAYMENT_PROVIDERS,
      inject: [MpesaProvider, PesapalSabiProvider, ExternalTerminalProvider],
      useFactory: (
        mpesa: MpesaProvider,
        pesapalSabi: PesapalSabiProvider,
        externalTerminal: ExternalTerminalProvider,
      ) => [mpesa, pesapalSabi, externalTerminal],
    },
    PaymentsService,
    PaymentAdjustmentsService,
    ManualTerminalService,
    PaymentRailService,
    PaymentMachineAuthService,
  ],
  exports: [PaymentsService, PaymentAdjustmentsService, ManualTerminalService, PaymentRailService],
})
export class PaymentsModule {}
