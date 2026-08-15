import { Body, Controller, Get, Headers, Inject, Param, Post } from '@nestjs/common';
import { ManualTerminalService } from './manual-terminal.service';
import { PaymentAdjustmentsService } from './payment-adjustments.service';
import {
  parseExternalTerminalConfirmation,
  parseInitiatePaymentRequest,
  parseRefundPaymentRequest,
  parseReversePaymentRequest,
} from './payment-validation';
import { PaymentRailService } from './payment-rail.service';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(PaymentAdjustmentsService) private readonly adjustments: PaymentAdjustmentsService,
    @Inject(ManualTerminalService) private readonly manualTerminal: ManualTerminalService,
    @Inject(PaymentRailService) private readonly rails: PaymentRailService,
  ) {}

  @Post('initiate')
  initiate(@Body() body: unknown) {
    return this.payments.initiate(parseInitiatePaymentRequest(body));
  }

  @Post('manual-terminal-confirmations')
  confirmExternalTerminal(@Body() body: unknown) {
    return this.manualTerminal.confirm(parseExternalTerminalConfirmation(body));
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
  async callback(
    @Param('providerId') providerId: string,
    @Body() body: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const result = await this.payments.ingestProviderCallback(providerId, body, { headers });
    if (providerId.trim().toLowerCase() === 'pesapal_sabi') {
      return { status: '200', message: 'Ok' };
    }
    return result;
  }

  @Post('attempts/:paymentAttemptId/reconcile')
  reconcile(@Param('paymentAttemptId') paymentAttemptId: string) {
    return this.payments.reconcileAttempt(paymentAttemptId);
  }

  @Get('providers/availability')
  railAvailability() {
    return this.rails.availability();
  }

  @Get(':paymentId/history')
  history(@Param('paymentId') paymentId: string) {
    return this.adjustments.history(paymentId);
  }

  @Get(':paymentId/manual-terminal-confirmations')
  manualTerminalHistory(@Param('paymentId') paymentId: string) {
    return this.manualTerminal.history(paymentId);
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
