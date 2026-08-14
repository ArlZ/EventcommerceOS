import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { AuthenticatedDevicePrincipal } from '@event-commerce/contracts';
import { EdgeRoute } from '../security/security-route';
import { EdgePaymentsService, parseEdgeInitiatePayment } from './payments.service';
import {
  assertEdgeInitiatePaymentEnvelope,
  parseEdgeExternalTerminalConfirmation,
  TerminalPaymentsService,
} from './terminal-payments.service';

interface DeviceRequest {
  securityPrincipal?: AuthenticatedDevicePrincipal;
}

@Controller('payments')
export class EdgePaymentsController {
  constructor(
    @Inject(EdgePaymentsService) private readonly payments: EdgePaymentsService,
    @Inject(TerminalPaymentsService) private readonly terminalPayments: TerminalPaymentsService,
  ) {}

  @Post('initiate')
  @EdgeRoute('DEVICE')
  initiate(@Req() securityRequest: DeviceRequest, @Body() body: unknown) {
    const principal = this.devicePrincipal(securityRequest);
    assertEdgeInitiatePaymentEnvelope(body);
    const request = parseEdgeInitiatePayment(body);
    if (request.eventId !== principal.eventId) {
      throw new ForbiddenException('Device credential cannot initiate payment for another event');
    }
    if (request.customerPhone !== undefined && request.providerId !== 'mpesa') {
      throw new Error('customerPhone is only accepted for the M-PESA provider');
    }
    if (request.providerId === 'pesapal_sabi' && request.accountReference !== request.paymentAttemptId) {
      throw new Error('Pesapal Sabi accountReference must equal paymentAttemptId');
    }
    return this.payments.initiate(request);
  }

  @Post('manual-terminal-confirmations')
  confirmExternalTerminal(@Body() body: unknown) {
    return this.terminalPayments.confirmExternalTerminal(
      parseEdgeExternalTerminalConfirmation(body),
    );
  }

  @Post('attempts/:paymentAttemptId/reconcile')
  @EdgeRoute('DEVICE')
  async reconcile(
    @Req() securityRequest: DeviceRequest,
    @Param('paymentAttemptId') paymentAttemptId: string,
  ) {
    const principal = this.devicePrincipal(securityRequest);
    await this.payments.assertAttemptEvent(paymentAttemptId, principal.eventId);
    return this.payments.reconcile(paymentAttemptId);
  }

  @Get('providers/availability')
  @EdgeRoute('DEVICE')
  railAvailability(@Req() securityRequest: DeviceRequest) {
    this.devicePrincipal(securityRequest);
    return this.terminalPayments.railAvailability();
  }

  @Get('orders/:orderId')
  @EdgeRoute('DEVICE')
  byOrder(@Req() securityRequest: DeviceRequest, @Param('orderId') orderId: string) {
    const principal = this.devicePrincipal(securityRequest);
    return this.payments.byOrderForEvent(orderId, principal.eventId);
  }

  private devicePrincipal(request: DeviceRequest): AuthenticatedDevicePrincipal {
    const principal = request.securityPrincipal;
    if (!principal || principal.principalType !== 'DEVICE') {
      throw new ForbiddenException('Authenticated device principal required');
    }
    return principal;
  }
}
