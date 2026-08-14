import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { CurrentOperator, OperatorGuard } from '../auth/operator-auth.guard';
import { OperatorAuthService, type OperatorIdentity } from '../auth/operator-auth.service';
import { EdgeCloudAuthService } from '../sync/edge-cloud-auth.service';
import { ManualTerminalService } from './manual-terminal.service';
import { PaymentAccessService } from './payment-access.service';
import { PaymentAdjustmentsService } from './payment-adjustments.service';
import {
  parseExternalTerminalConfirmation,
  parseInitiatePaymentRequest,
  parseRefundPaymentRequest,
  parseReversePaymentRequest,
} from './payment-validation';
import { PaymentRailService } from './payment-rail.service';
import { PaymentsService } from './payments.service';

type HeadersRecord = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function approvalToken(headers: HeadersRecord): string {
  const value = first(headers['x-approval-token'])?.trim();
  if (!value) throw new UnauthorizedException('Second-operator approval token is required');
  return value.startsWith('Bearer ') ? value.slice('Bearer '.length).trim() : value;
}

@Controller('payments')
export class PaymentsController {
  constructor(
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(PaymentAccessService) private readonly access: PaymentAccessService,
    @Inject(PaymentAdjustmentsService) private readonly adjustments: PaymentAdjustmentsService,
    @Inject(ManualTerminalService) private readonly manualTerminal: ManualTerminalService,
    @Inject(PaymentRailService) private readonly rails: PaymentRailService,
    @Inject(EdgeCloudAuthService) private readonly edgeAuth: EdgeCloudAuthService,
    @Inject(OperatorAuthService) private readonly operatorAuth: OperatorAuthService,
  ) {}

  @Post('initiate')
  async initiate(@Headers() headers: HeadersRecord, @Body() body: unknown) {
    const identity = await this.edgeAuth.authenticate(headers);
    const request = parseInitiatePaymentRequest(body);
    await this.edgeAuth.authorizeEvent(identity, request.eventId);
    return this.payments.initiate(request);
  }

  @Post('manual-terminal-confirmations')
  @UseGuards(OperatorGuard)
  async confirmExternalTerminal(
    @CurrentOperator() identity: OperatorIdentity,
    @Body() body: unknown,
  ) {
    const request = parseExternalTerminalConfirmation(body);
    const eventId = await this.access.eventForAttempt(request.paymentAttemptId);
    this.operatorAuth.requireRole(identity, ['SUPERVISOR', 'ADMIN', 'PLATFORM_ADMIN']);
    await this.operatorAuth.assertPaymentPermission(identity, eventId, 'PAYMENT_MANUAL_CONFIRM');
    if (request.actorId !== identity.actorId) {
      throw new ForbiddenException('Manual terminal actorId must match authenticated operator');
    }
    return this.manualTerminal.confirm({ ...request, actorId: identity.actorId });
  }

  @Post('refunds')
  @UseGuards(OperatorGuard)
  async refund(
    @CurrentOperator() identity: OperatorIdentity,
    @Headers() headers: HeadersRecord,
    @Body() body: unknown,
  ) {
    const request = parseRefundPaymentRequest(body);
    const eventId = await this.access.eventForPayment(request.paymentId);
    this.operatorAuth.requireRole(identity, ['SUPERVISOR', 'ADMIN', 'PLATFORM_ADMIN']);
    await this.operatorAuth.assertPaymentPermission(identity, eventId, 'PAYMENT_REFUND');
    if (request.requestingActorId !== identity.actorId) {
      throw new ForbiddenException('Refund requestingActorId must match authenticated operator');
    }

    const approver = await this.operatorAuth.authenticateToken(approvalToken(headers));
    this.operatorAuth.requireRole(approver, ['SUPERVISOR', 'ADMIN', 'PLATFORM_ADMIN']);
    await this.operatorAuth.assertPaymentPermission(approver, eventId, 'PAYMENT_REFUND');
    if (approver.actorId === identity.actorId) {
      throw new ForbiddenException('Refund approval requires a second operator');
    }
    if (request.approvingActorId !== undefined && request.approvingActorId !== approver.actorId) {
      throw new ForbiddenException('Refund approvingActorId must match approval token operator');
    }

    return this.adjustments.refund({
      ...request,
      requestingActorId: identity.actorId,
      approvingActorId: approver.actorId,
    });
  }

  @Post('reversals')
  @UseGuards(OperatorGuard)
  async reverse(@CurrentOperator() identity: OperatorIdentity, @Body() body: unknown) {
    const request = parseReversePaymentRequest(body);
    const eventId = await this.access.eventForPayment(request.paymentId);
    this.operatorAuth.requireRole(identity, ['ADMIN', 'PLATFORM_ADMIN']);
    await this.operatorAuth.assertEventAccess(identity, eventId);
    if (request.requestingActorId !== identity.actorId) {
      throw new ForbiddenException('Reversal requestingActorId must match authenticated operator');
    }
    return this.adjustments.reverse({ ...request, requestingActorId: identity.actorId });
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
    const identity = await this.edgeAuth.authenticate(headers);
    await this.edgeAuth.authorizeEvent(identity, await this.access.eventForAttempt(paymentAttemptId));
    return this.payments.reconcileAttempt(paymentAttemptId);
  }

  @Get('providers/availability')
  async railAvailability(@Headers() headers: HeadersRecord) {
    await this.edgeAuth.authenticate(headers);
    return this.rails.availability();
  }

  @Get(':paymentId/history')
  @UseGuards(OperatorGuard)
  async history(
    @CurrentOperator() identity: OperatorIdentity,
    @Param('paymentId') paymentId: string,
  ) {
    const eventId = await this.access.eventForPayment(paymentId);
    this.operatorAuth.requireRole(identity, ['SUPERVISOR', 'ADMIN', 'PLATFORM_ADMIN']);
    await this.operatorAuth.assertPaymentPermission(identity, eventId, 'PAYMENT_VIEW');
    return this.adjustments.history(paymentId);
  }

  @Get(':paymentId/manual-terminal-confirmations')
  @UseGuards(OperatorGuard)
  async manualTerminalHistory(
    @CurrentOperator() identity: OperatorIdentity,
    @Param('paymentId') paymentId: string,
  ) {
    const eventId = await this.access.eventForPayment(paymentId);
    this.operatorAuth.requireRole(identity, ['SUPERVISOR', 'ADMIN', 'PLATFORM_ADMIN']);
    await this.operatorAuth.assertPaymentPermission(identity, eventId, 'PAYMENT_VIEW');
    return this.manualTerminal.history(paymentId);
  }

  @Get('orders/:orderId')
  async byOrder(@Headers() headers: HeadersRecord, @Param('orderId') orderId: string) {
    const identity = await this.edgeAuth.authenticate(headers);
    await this.edgeAuth.authorizeEvent(identity, await this.access.eventForOrder(orderId));
    return this.payments.byOrder(orderId);
  }

  @Get('events/:eventId/health')
  @UseGuards(OperatorGuard)
  async health(
    @CurrentOperator() identity: OperatorIdentity,
    @Param('eventId') eventId: string,
  ) {
    this.operatorAuth.requireRole(identity, ['SUPERVISOR', 'ADMIN', 'PLATFORM_ADMIN']);
    await this.operatorAuth.assertPaymentPermission(identity, eventId, 'PAYMENT_VIEW');
    return this.payments.health(eventId);
  }
}
