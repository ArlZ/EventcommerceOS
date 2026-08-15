import { Body, Controller, ForbiddenException, Get, Headers, Inject, Param, Post } from '@nestjs/common';
import { OperatorAuthService, type HeadersRecord } from '../auth/operator-auth.service';
import { ManualTerminalService } from './manual-terminal.service';
import { PaymentAdjustmentsService } from './payment-adjustments.service';
import { PaymentMachineAuthService } from './payment-machine-auth.service';
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
    @Inject(PaymentMachineAuthService) private readonly machineAuth: PaymentMachineAuthService,
    @Inject(OperatorAuthService) private readonly operators: OperatorAuthService,
  ) {}

  @Post('initiate')
  async initiate(@Headers() headers: HeadersRecord, @Body() body: unknown) {
    const request = parseInitiatePaymentRequest(body);
    await this.machineAuth.authorizeInitiation(headers, request.eventId);
    return this.payments.initiate(request);
  }

  @Post('manual-terminal-confirmations')
  async confirmExternalTerminal(@Headers() headers: HeadersRecord, @Body() body: unknown) {
    const request = parseExternalTerminalConfirmation(body);
    const context = await this.operators.contextForPaymentAttempt(
      headers,
      request.paymentAttemptId,
      ['ADMIN', 'SUPERVISOR'],
    );
    this.operators.assertActor(context.actorId, request.actorId);
    return this.manualTerminal.confirm(request);
  }

  @Post('refunds')
  async refund(@Headers() headers: HeadersRecord, @Body() body: unknown) {
    const request = parseRefundPaymentRequest(body);
    const context = await this.operators.contextForPayment(headers, request.paymentId, ['FINANCE']);
    this.operators.assertActor(context.actorId, request.requestingActorId, 'requestingActorId');
    if (request.approvingActorId !== undefined) {
      throw new ForbiddenException(
        'approvingActorId is not accepted from public HTTP until a separate approval session is implemented',
      );
    }
    return this.adjustments.refund(request);
  }

  @Post('reversals')
  async reverse(@Headers() headers: HeadersRecord, @Body() body: unknown) {
    const request = parseReversePaymentRequest(body);
    const context = await this.operators.contextForPayment(headers, request.paymentId, ['FINANCE']);
    this.operators.assertActor(context.actorId, request.requestingActorId, 'requestingActorId');
    return this.adjustments.reverse(request);
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
  async history(@Headers() headers: HeadersRecord, @Param('paymentId') paymentId: string) {
    await this.operators.contextForPayment(headers, paymentId, ['ADMIN', 'FINANCE']);
    return this.adjustments.history(paymentId);
  }

  @Get(':paymentId/manual-terminal-confirmations')
  async manualTerminalHistory(
    @Headers() headers: HeadersRecord,
    @Param('paymentId') paymentId: string,
  ) {
    await this.operators.contextForPayment(headers, paymentId, [
      'ADMIN',
      'FINANCE',
      'SUPERVISOR',
    ]);
    return this.manualTerminal.history(paymentId);
  }

  @Get('orders/:orderId')
  async byOrder(@Headers() headers: HeadersRecord, @Param('orderId') orderId: string) {
    await this.machineAuth.authorizeOrder(headers, orderId);
    return this.payments.byOrder(orderId);
  }

  @Get('events/:eventId/health')
  async health(@Headers() headers: HeadersRecord, @Param('eventId') eventId: string) {
    await this.operators.contextForEvent(headers, eventId, [
      'ADMIN',
      'FINANCE',
      'SUPERVISOR',
      'VIEWER',
    ]);
    return this.payments.health(eventId);
  }
}
