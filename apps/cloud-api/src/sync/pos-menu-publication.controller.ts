import { Body, Controller, Get, Headers, Inject, Param, Post } from '@nestjs/common';
import { OperatorAuthService, type HeadersRecord } from '../auth/operator-auth.service';
import { uuid } from '../configuration/validation';
import { EdgeCloudAuthService } from './edge-cloud-auth.service';
import { PosMenuInstallReceiptService } from './pos-menu-install-receipt.service';
import { PosMenuPublicationService } from './pos-menu-publication.service';

@Controller()
export class PosMenuPublicationController {
  constructor(
    @Inject(PosMenuPublicationService)
    private readonly publications: PosMenuPublicationService,
    @Inject(PosMenuInstallReceiptService)
    private readonly installReceipts: PosMenuInstallReceiptService,
    @Inject(OperatorAuthService) private readonly operators: OperatorAuthService,
    @Inject(EdgeCloudAuthService) private readonly edgeAuth: EdgeCloudAuthService,
  ) {}

  @Post('events/:eventId/pos-menu-publications')
  async publish(@Headers() headers: HeadersRecord, @Param('eventId') rawEventId: string) {
    const eventId = uuid(rawEventId, 'eventId');
    const context = await this.operators.contextForEvent(headers, eventId, ['ADMIN']);
    return this.publications.publish(context, eventId);
  }

  @Get('events/:eventId/pos-menu-publication-status')
  async status(@Headers() headers: HeadersRecord, @Param('eventId') rawEventId: string) {
    const eventId = uuid(rawEventId, 'eventId');
    await this.operators.contextForEvent(headers, eventId, ['ADMIN']);
    return this.installReceipts.status(eventId);
  }

  @Get('sync/events/:eventId/pos-menu-publications')
  async latestForEdge(@Headers() headers: HeadersRecord, @Param('eventId') rawEventId: string) {
    const eventId = uuid(rawEventId, 'eventId');
    const identity = await this.edgeAuth.authenticate(headers);
    await this.edgeAuth.authorizeEventIds(identity, [eventId]);
    return this.publications.latest(eventId);
  }

  @Post('sync/events/:eventId/pos-menu-install-receipts')
  async recordInstallReceipts(
    @Headers() headers: HeadersRecord,
    @Param('eventId') rawEventId: string,
    @Body() body: unknown,
  ) {
    const eventId = uuid(rawEventId, 'eventId');
    const identity = await this.edgeAuth.authenticate(headers);
    await this.edgeAuth.authorizeEventIds(identity, [eventId]);
    return this.installReceipts.record(identity, eventId, body);
  }
}
