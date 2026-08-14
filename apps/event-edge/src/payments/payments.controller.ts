import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { EdgePaymentsService, parseEdgeInitiatePayment } from './payments.service';
import {
  assertEdgeInitiatePaymentEnvelope,
  parseEdgeExternalTerminalConfirmation,
  TerminalPaymentsService,
} from './terminal-payments.service';

@Controller('payments')
export class EdgePaymentsController {
  constructor(
    @Inject(EdgePaymentsService) private readonly payments: EdgePaymentsService,
    @Inject(TerminalPaymentsService) private readonly terminalPayments: TerminalPaymentsService,
  ) {}

  @Post('initiate')
  initiate(@Body() body: unknown) {
    assertEdgeInitiatePaymentEnvelope(body);
    return this.payments.initiate(parseEdgeInitiatePayment(body));
  }

  @Post('manual-terminal-confirmations')
  confirmExternalTerminal(@Body() body: unknown) {
    return this.terminalPayments.confirmExternalTerminal(
      parseEdgeExternalTerminalConfirmation(body),
    );
  }

  @Post('attempts/:paymentAttemptId/reconcile')
  reconcile(@Param('paymentAttemptId') paymentAttemptId: string) {
    return this.payments.reconcile(paymentAttemptId);
  }

  @Get('providers/availability')
  railAvailability() {
    return this.terminalPayments.railAvailability();
  }

  @Get('orders/:orderId')
  byOrder(@Param('orderId') orderId: string) {
    return this.payments.byOrder(orderId);
  }
}
