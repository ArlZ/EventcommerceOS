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
import { adminContextFromHeaders } from '../configuration/admin-context';
import { HumanPaymentAuthService } from './human-payment-auth.service';
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

type HeadersRecord = Record<string, string | string[] | undefined>;

@Controller('payments')
export class PaymentsController {
  constructor(
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(PaymentAdjustmentsService) private readonly adjustments: PaymentAdjustmentsService,
    @Inject(ManualTerminalService) private readonly manualTerminal: ManualTerminalService,
    @Inject(PaymentRailService) private readonly rails: PaymentRailService,
    @Inject(PaymentMachineAuthService) private readonly machineAuth: PaymentMachineAuthService,
    @Inject(HumanPaymentAuthService) private readonly humanAuth: HumanPaymentAuthService,
  ) {}

  @Post('initiate')
  async initiate(@Headers() headers: HeadersRecord, @Body() body: unknown) {
    const request = parseInitiatePaymentRequest(body);
    await this.machineAuth.authorizeInitiation(headers, request.eventId);
    return this.payments.initiate(request);
  }

  @Post('manual-terminal-confirmations')
  async confirmExternalTerminal(@Headers() headers: HeadersRecord, @Body() body: unknown) {
    const context = adminContextFromHeaders(headers, false);
    const request = parseExternalTerminalConfirmation(body);
    this.humanAuth.assertActor(context, request.actorId, 'actorId');
    await this.humanAuth.authorizeAttempt(context, request.paymentAttemptId);
    return this.manualTerminal.confirm(request);
  }

  @Post('refunds')
  async refund(@Headers() headers: HeadersRecord, @Body() body: unknown) {
    const context = adminContextFromHeaders(headers, false);
    const request = parseRefundPaymentRequest(body);
    this.humanAuth.assertActor(context, request.requestingActorId, 'requestingActorId');
    if (request.approvingActorId !== undefined) {
      throw new ForbiddenException(
        'approvingActorId cannot be asserted by the requester; second-actor approval requires a dedicated authenticated approval flow',
      );
    }
    await this.humanAuth.authorizePayment(context, request.paymentId);
    return this.adjustments.refund(request);
  }

  @Post('reversals')
  async reverse(@Headers() headers: HeadersRecord, @Body() body: unknown) {
    const context = adminContextFromHeaders(headers, false);
    const request = parseReversePaymentRequest(body);
    this.humanAuth.assertActor(context, request.requestingActorId, 'requestingActorId');
    await this.humanAuth.authorizePayment(context, request.paymentId);
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
    const context = adminContextFromHeaders(headers, false);
    await this.humanAuth.authorizePayment(context, paymentId);
    return this.adjustments.history(paymentId);
  }

  @Get(':paymentId/manual-terminal-confirmations')
  async manualTerminalHistory(
    @Headers() headers: HeadersRecord,
    @Param('paymentId') paymentId: string,
  ) {
    const context = adminContextFromHeaders(headers, false);
    await this.humanAuth.authorizePayment(context, paymentId);
    return this.manualTerminal.history(paymentId);
  }

  @Get('orders/:orderId')
  async byOrder(@Headers() headers: HeadersRecord, @Param('orderId') orderId: string) {
    await this.machineAuth.authorizeOrder(headers, orderId);
    return this.payments.byOrder(orderId);
  }

  @Get('events/:eventId/health')
  async health(@Headers() headers: HeadersRecord, @Param('eventId') eventId: string) {
    const context = adminContextFromHeaders(headers, false);
    await this.humanAuth.authorizeEvent(context, eventId);
    return this.payments.health(eventId);
  }
}
