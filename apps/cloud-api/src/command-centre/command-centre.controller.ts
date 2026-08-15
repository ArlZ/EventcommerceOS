import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Sse,
} from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { from, type Observable } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { OperatorAuthService, type HeadersRecord } from '../auth/operator-auth.service';
import { uuid } from '../configuration/validation';
import type { CommandCentreDeviceSalesService } from './command-centre-device-sales.service';
import type { CommandCentreService } from './command-centre.service';
import { parseInventoryAlertAction } from './command-centre-validation';

@Controller('command-centre')
export class CommandCentreController {
  constructor(
    private readonly commandCentre: CommandCentreService,
    private readonly deviceSales: CommandCentreDeviceSalesService,
    @Inject(OperatorAuthService) private readonly operators: OperatorAuthService,
  ) {}

  @Get('events/:eventId')
  async snapshot(@Headers() headers: HeadersRecord, @Param('eventId') eventId: string) {
    const normalizedEventId = uuid(eventId, 'eventId');
    const context = await this.operators.contextForEvent(headers, normalizedEventId, [
      'ADMIN',
      'SUPERVISOR',
      'FINANCE',
      'VIEWER',
    ]);
    const snapshot = await this.commandCentre.snapshot(context, normalizedEventId);
    try {
      return await this.deviceSales.enrich(normalizedEventId, snapshot);
    } catch {
      return snapshot;
    }
  }

  @Sse('events/:eventId/stream')
  stream(
    @Headers() headers: HeadersRecord,
    @Param('eventId') eventId: string,
  ): Observable<MessageEvent> {
    const normalizedEventId = uuid(eventId, 'eventId');
    return from(
      this.operators.contextForEvent(headers, normalizedEventId, [
        'ADMIN',
        'SUPERVISOR',
        'FINANCE',
        'VIEWER',
      ]),
    ).pipe(switchMap((context) => this.commandCentre.stream(context, normalizedEventId)));
  }

  @Post('events/:eventId/inventory-alerts/:alertId/actions')
  async actOnInventoryAlert(
    @Headers() headers: HeadersRecord,
    @Param('eventId') eventId: string,
    @Param('alertId') alertId: string,
    @Body() body: unknown,
  ) {
    const normalizedEventId = uuid(eventId, 'eventId');
    const context = await this.operators.contextForEvent(headers, normalizedEventId, [
      'ADMIN',
      'SUPERVISOR',
    ]);
    const normalizedAlertId = alertId.trim();
    if (!normalizedAlertId) throw new BadRequestException('alertId must not be empty');
    return this.commandCentre.actOnInventoryAlert(
      context,
      normalizedEventId,
      normalizedAlertId,
      parseInventoryAlertAction(body),
    );
  }
}
