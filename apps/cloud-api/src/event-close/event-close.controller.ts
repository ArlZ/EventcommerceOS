import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  StreamableFile,
} from '@nestjs/common';
import { OperatorAuthService, type HeadersRecord } from '../auth/operator-auth.service';
import { uuid } from '../configuration/validation';
import { EventCloseLedgerService } from './event-close-ledger.service';
import { EventCloseService } from './event-close.service';
import {
  parseCashDeclaration,
  parseCloseAction,
  parseInventoryCostDeclaration,
  parseOrderAdjustment,
} from './event-close-validation';

function revision(value: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new BadRequestException('revision must be a positive integer');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new BadRequestException('revision must be a positive integer');
  }
  return parsed;
}

const READ_ROLES = ['ADMIN', 'FINANCE', 'SUPERVISOR', 'VIEWER'] as const;
const CORRECTION_ROLES = ['ADMIN', 'FINANCE', 'SUPERVISOR'] as const;

@Controller('event-close/events/:eventId')
export class EventCloseController {
  constructor(
    private readonly close: EventCloseService,
    private readonly ledger: EventCloseLedgerService,
    @Inject(OperatorAuthService) private readonly operators: OperatorAuthService,
  ) {}

  @Get('report')
  async report(@Headers() headers: HeadersRecord, @Param('eventId') eventId: string) {
    const normalizedEventId = uuid(eventId, 'eventId');
    const context = await this.operators.contextForEvent(headers, normalizedEventId, READ_ROLES);
    return this.close.liveReport(context, normalizedEventId);
  }

  @Get('report.csv')
  async reportCsv(@Headers() headers: HeadersRecord, @Param('eventId') eventId: string) {
    const normalizedEventId = uuid(eventId, 'eventId');
    const context = await this.operators.contextForEvent(headers, normalizedEventId, READ_ROLES);
    const report = await this.close.liveReport(context, normalizedEventId);
    return new StreamableFile(Buffer.from(this.close.csv(report), 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="event-close-${normalizedEventId}.csv"`,
    });
  }

  @Post('order-adjustments')
  async orderAdjustment(
    @Headers() headers: HeadersRecord,
    @Param('eventId') eventId: string,
    @Body() body: unknown,
  ) {
    const normalizedEventId = uuid(eventId, 'eventId');
    const context = await this.operators.contextForEvent(
      headers,
      normalizedEventId,
      CORRECTION_ROLES,
    );
    return this.ledger.recordOrderAdjustment(context, normalizedEventId, parseOrderAdjustment(body));
  }

  @Post('cash-declarations')
  async cashDeclaration(
    @Headers() headers: HeadersRecord,
    @Param('eventId') eventId: string,
    @Body() body: unknown,
  ) {
    const normalizedEventId = uuid(eventId, 'eventId');
    const context = await this.operators.contextForEvent(
      headers,
      normalizedEventId,
      CORRECTION_ROLES,
    );
    return this.ledger.declareCash(context, normalizedEventId, parseCashDeclaration(body));
  }

  @Post('inventory-unit-costs')
  async inventoryCost(
    @Headers() headers: HeadersRecord,
    @Param('eventId') eventId: string,
    @Body() body: unknown,
  ) {
    const normalizedEventId = uuid(eventId, 'eventId');
    const context = await this.operators.contextForEvent(headers, normalizedEventId, [
      'ADMIN',
      'FINANCE',
    ]);
    return this.ledger.declareInventoryCost(
      context,
      normalizedEventId,
      parseInventoryCostDeclaration(body),
    );
  }

  @Post('close')
  async operationallyClose(
    @Headers() headers: HeadersRecord,
    @Param('eventId') eventId: string,
    @Body() body: unknown,
  ) {
    const normalizedEventId = uuid(eventId, 'eventId');
    const context = await this.operators.contextForEvent(headers, normalizedEventId, ['ADMIN']);
    return this.close.operationallyClose(context, normalizedEventId, parseCloseAction(body));
  }

  @Post('reopen')
  async reopen(
    @Headers() headers: HeadersRecord,
    @Param('eventId') eventId: string,
    @Body() body: unknown,
  ) {
    const normalizedEventId = uuid(eventId, 'eventId');
    const context = await this.operators.contextForEvent(headers, normalizedEventId, ['ADMIN']);
    return this.close.reopen(context, normalizedEventId, parseCloseAction(body));
  }

  @Get('actions')
  async actions(@Headers() headers: HeadersRecord, @Param('eventId') eventId: string) {
    const normalizedEventId = uuid(eventId, 'eventId');
    const context = await this.operators.contextForEvent(headers, normalizedEventId, READ_ROLES);
    return this.close.actions(context, normalizedEventId);
  }

  @Get('reports')
  async reports(@Headers() headers: HeadersRecord, @Param('eventId') eventId: string) {
    const normalizedEventId = uuid(eventId, 'eventId');
    const context = await this.operators.contextForEvent(headers, normalizedEventId, READ_ROLES);
    return this.close.storedReports(context, normalizedEventId);
  }

  @Get('reports/:revision')
  async storedReport(
    @Headers() headers: HeadersRecord,
    @Param('eventId') eventId: string,
    @Param('revision') value: string,
  ) {
    const normalizedEventId = uuid(eventId, 'eventId');
    const context = await this.operators.contextForEvent(headers, normalizedEventId, READ_ROLES);
    return this.close.storedReport(context, normalizedEventId, revision(value));
  }

  @Get('reports/:revision/export.csv')
  async storedReportCsv(
    @Headers() headers: HeadersRecord,
    @Param('eventId') eventId: string,
    @Param('revision') value: string,
  ) {
    const normalizedEventId = uuid(eventId, 'eventId');
    const normalizedRevision = revision(value);
    const context = await this.operators.contextForEvent(headers, normalizedEventId, READ_ROLES);
    const stored = await this.close.storedReport(context, normalizedEventId, normalizedRevision);
    return new StreamableFile(Buffer.from(this.close.csv(stored.report), 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="event-close-${normalizedEventId}-r${normalizedRevision}.csv"`,
    });
  }
}
