import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { InitiatePaymentResponse, PaymentAttemptSnapshot } from '@event-commerce/contracts';
import { PaymentEdgeAuthGuard } from './payment-edge-auth.guard';
import { PaymentService } from './payment.service';
import { parseInitiatePaymentRequest } from './payment-validation';
import { PaymentWebhookService, type WebhookIngestResult } from './payment-webhook.service';

@Controller('payments')
export class PaymentController {
  constructor(
    @Inject(PaymentService) private readonly payments: PaymentService,
    @Inject(PaymentWebhookService) private readonly webhooks: PaymentWebhookService,
  ) {}

  @Post('attempts')
  @UseGuards(PaymentEdgeAuthGuard)
  initiate(@Body() body: unknown): Promise<InitiatePaymentResponse> {
    return this.payments.initiate(parseInitiatePaymentRequest(body));
  }

  @Get('attempts/:attemptId')
  @UseGuards(PaymentEdgeAuthGuard)
  getAttempt(@Param('attemptId') attemptId: string): Promise<PaymentAttemptSnapshot> {
    return this.payments.getAttempt(attemptId);
  }

  @Post('attempts/:attemptId/reconcile')
  @UseGuards(PaymentEdgeAuthGuard)
  async reconcile(@Param('attemptId') attemptId: string): Promise<PaymentAttemptSnapshot> {
    await this.payments.reconcileAttempt(attemptId);
    return this.payments.getAttempt(attemptId);
  }

  @Post('webhooks/mpesa')
  webhook(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: unknown,
  ): Promise<WebhookIngestResult> {
    return this.webhooks.ingest({ headers, body, receivedAt: new Date().toISOString() });
  }
}
