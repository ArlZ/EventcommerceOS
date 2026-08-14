import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { DeviceEdgeAuthService } from '../security/device-edge-auth.service';
import { EdgePaymentsService, parseEdgeInitiatePayment } from './payments.service';
import {
  assertEdgeInitiatePaymentEnvelope,
  parseEdgeExternalTerminalConfirmation,
  TerminalPaymentsService,
} from './terminal-payments.service';

type HeadersRecord = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

@Controller('payments')
export class EdgePaymentsController {
  constructor(
    @Inject(EdgePaymentsService) private readonly payments: EdgePaymentsService,
    @Inject(TerminalPaymentsService) private readonly terminalPayments: TerminalPaymentsService,
    @Inject(DeviceEdgeAuthService) private readonly deviceAuth: DeviceEdgeAuthService,
  ) {}

  @Post('initiate')
  async initiate(@Headers() headers: HeadersRecord, @Body() body: unknown) {
    const identity = await this.deviceAuth.authenticate(headers);
    assertEdgeInitiatePaymentEnvelope(body);
    const request = parseEdgeInitiatePayment(body);
    this.deviceAuth.authorizePaymentInitiation(identity, request);
    if (request.customerPhone !== undefined && request.providerId !== 'mpesa') {
      throw new Error('customerPhone is only accepted for the M-PESA provider');
    }
    if (request.providerId === 'pesapal_sabi' && request.accountReference !== request.paymentAttemptId) {
      throw new Error('Pesapal Sabi accountReference must equal paymentAttemptId');
    }
    return this.payments.initiate(request, identity.deviceId);
  }

  @Post('manual-terminal-confirmations')
  confirmExternalTerminal(@Headers() headers: HeadersRecord, @Body() body: unknown) {
    const authorization = first(headers.authorization)?.trim();
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Operator bearer access token required');
    }
    return this.terminalPayments.confirmExternalTerminal(
      parseEdgeExternalTerminalConfirmation(body),
      authorization,
    );
  }

  @Post('attempts/:paymentAttemptId/reconcile')
  async reconcile(
    @Headers() headers: HeadersRecord,
    @Param('paymentAttemptId') paymentAttemptId: string,
  ) {
    const identity = await this.deviceAuth.authenticate(headers);
    await this.deviceAuth.authorizePaymentAttempt(identity, paymentAttemptId);
    return this.payments.reconcile(paymentAttemptId);
  }

  @Get('providers/availability')
  async railAvailability(@Headers() headers: HeadersRecord) {
    await this.deviceAuth.authenticate(headers);
    return this.terminalPayments.railAvailability();
  }

  @Get('orders/:orderId')
  async byOrder(@Headers() headers: HeadersRecord, @Param('orderId') orderId: string) {
    const identity = await this.deviceAuth.authenticate(headers);
    await this.deviceAuth.authorizeOrder(identity, orderId);
    return this.payments.byOrder(orderId);
  }
}
