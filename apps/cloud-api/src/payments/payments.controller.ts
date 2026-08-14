import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { parseInitiatePaymentRequest } from './payment-validation';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(@Inject(PaymentsService) private readonly payments: PaymentsService) {}

  @Post('initiate')
  initiate(@Body() body: unknown) {
    return this.payments.initiate(parseInitiatePaymentRequest(body));
  }

  @Post('providers/:providerId/callback')
  callback(@Param('providerId') providerId: string, @Body() body: unknown) {
    return this.payments.ingestProviderCallback(providerId, body);
  }

  @Post('attempts/:paymentAttemptId/reconcile')
  reconcile(@Param('paymentAttemptId') paymentAttemptId: string) {
    return this.payments.reconcileAttempt(paymentAttemptId);
  }

  @Get('orders/:orderId')
  byOrder(@Param('orderId') orderId: string) {
    return this.payments.byOrder(orderId);
  }

  @Get('events/:eventId/health')
  health(@Param('eventId') eventId: string) {
    return this.payments.health(eventId);
  }
}
