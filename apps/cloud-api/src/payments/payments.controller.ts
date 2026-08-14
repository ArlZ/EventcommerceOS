import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import { ManualTerminalService } from './manual-terminal.service';
import { PaymentAdjustmentsService } from './payment-adjustments.service';
import { PaymentMachineAuthService } from './payment-machine-auth.service';
import { parseInitiatePaymentRequest } from './payment-validation';
import { PaymentRailService } from './payment-rail.service';
import { PaymentsService } from './payments.service';

type HeadersRecord = Record<string, string | string[] | undefined>;

function humanAuthRequired(): never {
  throw new ForbiddenException('Human authentication and authorization are required for this payment operation');
}

@Controller('payments')
export class PaymentsController {
  constructor(
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(PaymentAdjustmentsService) private readonly adjustments: PaymentAdjustmentsService,
    @Inject(ManualTerminalService) private readonly manualTerminal: ManualTerminalService,
    @Inject(PaymentRailService) private readonly rails: PaymentRailService,
    @Inject(PaymentMachineAuthService) private readonly machineAuth: PaymentMachineAuthService,
  ) {}

  @Post('initiate')
  async initiate(@Headers() headers: HeadersRecord, @Body() body: unknown) {
    const request = parseInitiatePaymentRequest(body);
    await this.machineAuth.authorizeInitiation(headers, request.eventId);
    return this.payments.initiate(request);
  }

  @Post('manual-terminal-confirmations')
  confirmExternalTerminal() {
    return humanAuthRequired();
  }

  @Post('refunds')
  refund() {
    return humanAuthRequired();
  }

  @Post('reversals')
  reverse() {
    return humanAuthRequired();
  }

  @Post('providers/:providerId/callback')
  async callback(
    @Param('providerId') providerId: string,
    @Body() body: unknown,
    @Headers() headers: HeadersRecord,
  ) {
    const result = await this.payments.ingestProviderCallback(providerId, body, { headers });
    if (providerId.trim().toLowerCase() === 'pesapal_sabi') {
      return { status: '200', message: 'Ok' };
    }
    return result;
  }

  @Post('attempts/:paymentAttemptId/reconcile')
  async reconcile(
    @Headers() headers: HeadersRecord,
    @Param('paymentAttemptId') paymentAttemptId: string,
  ) {
    await this.machineAuth.authorizeAttempt(headers, paymentAttemptId);
    return this.payments.reconcileAttempt(paymentAttemptId);
  }

  @Get('providers/availability')
  async railAvailability(@Headers() headers: HeadersRecord) {
    await this.machineAuth.authenticate(headers);
    return this.rails.availability();
  }

  @Get(':paymentId/history')
  history() {
    return humanAuthRequired();
  }

  @Get(':paymentId/manual-terminal-confirmations')
  manualTerminalHistory() {
    return humanAuthRequired();
  }

  @Get('orders/:orderId')
  async byOrder(@Headers() headers: HeadersRecord, @Param('orderId') orderId: string) {
    await this.machineAuth.authorizeOrder(headers, orderId);
    return this.payments.byOrder(orderId);
  }

  @Get('events/:eventId/health')
  health() {
    return humanAuthRequired();
  }
}
