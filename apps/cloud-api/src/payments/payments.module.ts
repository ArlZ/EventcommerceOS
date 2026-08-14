import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ExternalTerminalProvider } from './external-terminal.provider';
import { MpesaProvider } from './mpesa.provider';
import { PaymentAdjustmentsService } from './payment-adjustments.service';
import { PAYMENT_PROVIDERS } from './payment-provider';
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
    PaymentAdjustmentsService,
  ],
  exports: [PaymentsService, PaymentAdjustmentsService],
})
export class PaymentsModule {}
