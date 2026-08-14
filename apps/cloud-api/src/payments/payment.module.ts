import { Module } from '@nestjs/common';
import { MpesaDarajaProvider } from './mpesa-daraja.provider';
import { PaymentController } from './payment.controller';
import { PaymentEdgeAuthGuard } from './payment-edge-auth.guard';
import { PAYMENT_PROVIDER } from './payment-provider';
import { PaymentReconciliationService } from './payment-reconciliation.service';
import { PaymentService } from './payment.service';
import { PaymentWebhookService } from './payment-webhook.service';

@Module({
  controllers: [PaymentController],
  providers: [
    PaymentService,
    PaymentWebhookService,
    PaymentReconciliationService,
    PaymentEdgeAuthGuard,
    { provide: PAYMENT_PROVIDER, useFactory: () => new MpesaDarajaProvider() },
  ],
  exports: [PaymentService],
})
export class PaymentModule {}
