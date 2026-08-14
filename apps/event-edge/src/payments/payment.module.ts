import { Module } from '@nestjs/common';
import { HttpPaymentCloudTransport } from './http-payment-cloud.transport';
import { PaymentCloudTransport } from './payment-cloud.transport';
import { PaymentController } from './payment.controller';
import { PaymentRefreshService } from './payment-refresh.service';
import { PaymentRelayService } from './payment-relay.service';

@Module({
  controllers: [PaymentController],
  providers: [
    PaymentRelayService,
    PaymentRefreshService,
    { provide: PaymentCloudTransport, useClass: HttpPaymentCloudTransport },
  ],
  exports: [PaymentRelayService],
})
export class PaymentModule {}
