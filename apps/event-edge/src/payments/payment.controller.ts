import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { InitiatePaymentResponse, PaymentAttemptSnapshot } from '@event-commerce/contracts';
import { PaymentDeviceAuthGuard } from './payment-device-auth.guard';
import { PaymentRelayService } from './payment-relay.service';
import { parseEdgeInitiatePaymentRequest } from './payment.validation';

@Controller('payments')
@UseGuards(PaymentDeviceAuthGuard)
export class PaymentController {
  constructor(@Inject(PaymentRelayService) private readonly payments: PaymentRelayService) {}

  @Post('attempts')
  initiate(@Body() body: unknown): Promise<InitiatePaymentResponse> {
    return this.payments.initiate(parseEdgeInitiatePaymentRequest(body));
  }

  @Get('attempts/:attemptId')
  getAttempt(
    @Param('attemptId') attemptId: string,
    @Query('refresh') refresh?: string,
  ): Promise<PaymentAttemptSnapshot> {
    return this.payments.getAttempt(attemptId, refresh !== 'false');
  }
}
