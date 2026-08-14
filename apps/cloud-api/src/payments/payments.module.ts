import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ExternalTerminalProvider } from './external-terminal.provider';
import { ManualTerminalService } from './manual-terminal.service';
import { MpesaProvider } from './mpesa.provider';
import { PaymentAccessService } from './payment-access.service';
import { PaymentAdjustmentsService } from './payment-adjustments.service';
import { PAYMENT_PROVIDERS } from './payment-provider';
import { PaymentRailService } from './payment-rail.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PesapalSabiProvider } from './pesapal-sabi.provider';

@Module({
  imports: [DatabaseModule],
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
    PaymentAccessService,
    PaymentAdjustmentsService,
    ManualTerminalService,
    PaymentRailService,
  ],
  exports: [
    PaymentsService,
    PaymentAccessService,
    PaymentAdjustmentsService,
    ManualTerminalService,
    PaymentRailService,
  ],
})
export class PaymentsModule {}
