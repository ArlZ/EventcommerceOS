import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  StreamableFile,
} from '@nestjs/common';
import { adminContextFromHeaders } from '../configuration/admin-context';
import { uuid } from '../configuration/validation';
import { EventCloseLedgerService } from './event-close-ledger.service';
import { EventCloseService } from './event-close.service';
import {
  parseCashDeclaration,
  parseCloseAction,
  parseInventoryCostDeclaration,
  parseOrderAdjustment,
} from './event-close-validation';

type HeadersRecord = Record<string, string | string[] | undefined>;

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

@Controller('event-close/events/:eventId')
export class EventCloseController {
  constructor(
    private readonly close: EventCloseService,
    private readonly ledger: EventCloseLedgerService,
  ) {}

  @Get('report')
  report(@Headers() headers: HeadersRecord, @Param('eventId') eventId: string) {
    return this.close.liveReport(adminContextFromHeaders(headers), uuid(eventId, 'eventId'));
  }

  @Get('report.csv')
  async reportCsv(@Headers() headers: HeadersRecord, @Param('eventId') eventId: string) {
    const normalizedEventId = uuid(eventId, 'eventId');
    const report = await this.close.liveReport(adminContextFromHeaders(headers), normalizedEventId);
    return new StreamableFile(Buffer.from(this.close.csv(report), 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="event-close-${normalizedEventId}.csv"`,
    });
  }

  @Post('order-adjustments')
  orderAdjustment(
    @Headers() headers: HeadersRecord,
    @Param('eventId') eventId: string,
    @Body() body: unknown,
  ) {
    return this.ledger.recordOrderAdjustment(
      adminContextFromHeaders(headers),
      uuid(eventId, 'eventId'),
      parseOrderAdjustment(body),
    );
  }

  @Post('cash-declarations')
  cashDeclaration(
    @Headers() headers: HeadersRecord,
    @Param('eventId') eventId: string,
    @Body() body: unknown,
  ) {
    return this.ledger.declareCash(
      adminContextFromHeaders(headers),
      uuid(eventId, 'eventId'),
      parseCashDeclaration(body),
    );
  }

  @Post('inventory-unit-costs')
  inventoryCost(
    @Headers() headers: HeadersRecord,
    @Param('eventId') eventId: string,
    @Body() body: unknown,
  ) {
    return this.ledger.declareInventoryCost(
      adminContextFromHeaders(headers),
      uuid(eventId, 'eventId'),
      parseInventoryCostDeclaration(body),
    );
  }

  @Post('close')
  operationallyClose(
    @Headers() headers: HeadersRecord,
    @Param('eventId') eventId: string,
    @Body() body: unknown,
  ) {
    return this.close.operationallyClose(
      adminContextFromHeaders(headers),
      uuid(eventId, 'eventId'),
      parseCloseAction(body),
    );
  }

  @Post('reopen')
  reopen(
    @Headers() headers: HeadersRecord,
    @Param('eventId') eventId: string,
    @Body() body: unknown,
  ) {
    return this.close.reopen(
      adminContextFromHeaders(headers),
      uuid(eventId, 'eventId'),
      parseCloseAction(body),
    );
  }

  @Get('actions')
  actions(@Headers() headers: HeadersRecord, @Param('eventId') eventId: string) {
    return this.close.actions(adminContextFromHeaders(headers), uuid(eventId, 'eventId'));
  }

  @Get('reports')
  reports(@Headers() headers: HeadersRecord, @Param('eventId') eventId: string) {
    return this.close.storedReports(adminContextFromHeaders(headers), uuid(eventId, 'eventId'));
  }

  @Get('reports/:revision')
  storedReport(
    @Headers() headers: HeadersRecord,
    @Param('eventId') eventId: string,
    @Param('revision') value: string,
  ) {
    return this.close.storedReport(
      adminContextFromHeaders(headers),
      uuid(eventId, 'eventId'),
      revision(value),
    );
  }

  @Get('reports/:revision/export.csv')
  async storedReportCsv(
    @Headers() headers: HeadersRecord,
    @Param('eventId') eventId: string,
    @Param('revision') value: string,
  ) {
    const normalizedEventId = uuid(eventId, 'eventId');
    const normalizedRevision = revision(value);
    const stored = await this.close.storedReport(
      adminContextFromHeaders(headers),
      normalizedEventId,
      normalizedRevision,
    );
    return new StreamableFile(Buffer.from(this.close.csv(stored.report), 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="event-close-${normalizedEventId}-r${normalizedRevision}.csv"`,
    });
  }
}
