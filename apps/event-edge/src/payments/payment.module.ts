import { Module } from '@nestjs/common';
import { HttpPaymentCloudTransport } from './http-payment-cloud.transport';
import { PaymentCloudTransport } from './payment-cloud.transport';
import { PaymentController } from './payment.controller';
import { PaymentDeviceAuthGuard } from './payment-device-auth.guard';
import { PaymentRefreshService } from './payment-refresh.service';
import { PaymentRelayService } from './payment-relay.service';

@Module({
  controllers: [PaymentController],
  providers: [
    PaymentRelayService,
    PaymentRefreshService,
    PaymentDeviceAuthGuard,
    { provide: PaymentCloudTransport, useClass: HttpPaymentCloudTransport },
  ],
  exports: [PaymentRelayService],
})
export class PaymentModule {}
