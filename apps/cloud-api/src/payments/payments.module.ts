import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { MpesaProvider } from './mpesa.provider';
import { PAYMENT_PROVIDERS } from './payment-provider';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [DatabaseModule],
  controllers: [PaymentsController],
  providers: [
    MpesaProvider,
    {
      provide: PAYMENT_PROVIDERS,
      inject: [MpesaProvider],
      useFactory: (mpesa: MpesaProvider) => [mpesa],
    },
    PaymentsService,
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
