import { Body, Controller, Get, Headers, Inject, Param, Post } from '@nestjs/common';
import { PaymentAdjustmentsService } from './payment-adjustments.service';
import {
  parseExternalTerminalConfirmation,
  parseInitiatePaymentRequest,
  parseRefundPaymentRequest,
  parseReversePaymentRequest,
} from './payment-validation';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(PaymentAdjustmentsService) private readonly adjustments: PaymentAdjustmentsService,
  ) {}

  @Post('initiate')
  initiate(@Body() body: unknown) {
    return this.payments.initiate(parseInitiatePaymentRequest(body));
  }

  @Post('manual-terminal-confirmations')
  confirmExternalTerminal(@Body() body: unknown) {
    return this.payments.confirmExternalTerminal(parseExternalTerminalConfirmation(body));
  }

  @Post('refunds')
  refund(@Body() body: unknown) {
    return this.adjustments.refund(parseRefundPaymentRequest(body));
  }

  @Post('reversals')
  reverse(@Body() body: unknown) {
    return this.adjustments.reverse(parseReversePaymentRequest(body));
  }

  @Post('providers/:providerId/callback')
  callback(
    @Param('providerId') providerId: string,
    @Body() body: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.payments.ingestProviderCallback(providerId, body, { headers });
  }

  @Post('attempts/:paymentAttemptId/reconcile')
  reconcile(@Param('paymentAttemptId') paymentAttemptId: string) {
    return this.payments.reconcileAttempt(paymentAttemptId);
  }

  @Get('providers/availability')
  railAvailability() {
    return this.payments.railAvailability();
  }

  @Get(':paymentId/history')
  history(@Param('paymentId') paymentId: string) {
    return this.adjustments.history(paymentId);
  }

  @Get(':paymentId/manual-terminal-confirmations')
  manualTerminalHistory(@Param('paymentId') paymentId: string) {
    return this.payments.manualTerminalHistory(paymentId);
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
