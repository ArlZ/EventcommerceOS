import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { EdgePaymentsService, parseEdgeInitiatePayment } from './payments.service';

@Controller('payments')
export class EdgePaymentsController {
  constructor(@Inject(EdgePaymentsService) private readonly payments: EdgePaymentsService) {}

  @Post('initiate')
  initiate(@Body() body: unknown) {
    return this.payments.initiate(parseEdgeInitiatePayment(body));
  }

  @Post('attempts/:paymentAttemptId/reconcile')
  reconcile(@Param('paymentAttemptId') paymentAttemptId: string) {
    return this.payments.reconcile(paymentAttemptId);
  }

  @Get('orders/:orderId')
  byOrder(@Param('orderId') orderId: string) {
    return this.payments.byOrder(orderId);
  }
}
