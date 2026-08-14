import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type {
  AuthenticatedEdgePrincipal,
  AuthenticatedOperatorPrincipal,
} from '@event-commerce/contracts';
import { EdgeScopeService } from '../security/edge-scope.service';
import { SecurityRoute } from '../security/security-route';
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

interface SecurityRequest {
  securityPrincipal?: AuthenticatedEdgePrincipal | AuthenticatedOperatorPrincipal;
}

@Controller('payments')
export class PaymentsController {
  constructor(
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(PaymentAdjustmentsService) private readonly adjustments: PaymentAdjustmentsService,
    @Inject(ManualTerminalService) private readonly manualTerminal: ManualTerminalService,
    @Inject(PaymentRailService) private readonly rails: PaymentRailService,
    @Inject(EdgeScopeService) private readonly edgeScope: EdgeScopeService,
  ) {}

  @Post('initiate')
  @SecurityRoute('EDGE_SERVICE')
  initiate(@Req() request: SecurityRequest, @Body() body: unknown) {
    const principal = this.edgePrincipal(request);
    const payment = parseInitiatePaymentRequest(body);
    this.edgeScope.assertEvent(principal, payment.eventId);
    return this.payments.initiate(payment);
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
  @SecurityRoute('PROVIDER_CALLBACK')
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
  @SecurityRoute('OPERATOR_OR_EDGE')
  async reconcile(
    @Req() request: SecurityRequest,
    @Param('paymentAttemptId') paymentAttemptId: string,
  ) {
    if (request.securityPrincipal?.principalType === 'EDGE_SERVICE') {
      await this.edgeScope.assertPaymentAttempt(request.securityPrincipal, paymentAttemptId);
    }
    return this.payments.reconcileAttempt(paymentAttemptId);
  }

  @Get('providers/availability')
  @SecurityRoute('OPERATOR_OR_EDGE')
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

  private edgePrincipal(request: SecurityRequest): AuthenticatedEdgePrincipal {
    const principal = request.securityPrincipal;
    if (!principal || principal.principalType !== 'EDGE_SERVICE') {
      throw new ForbiddenException('Authenticated Event Edge principal required');
    }
    return principal;
  }
}
