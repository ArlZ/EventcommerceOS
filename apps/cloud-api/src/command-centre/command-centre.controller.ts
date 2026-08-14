import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Sse } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { adminContextFromHeaders } from '../configuration/admin-context';
import { uuid } from '../configuration/validation';
import { CommandCentreDeviceSalesService } from './command-centre-device-sales.service';
import { CommandCentreService } from './command-centre.service';
import { parseInventoryAlertAction } from './command-centre-validation';

type HeadersRecord = Record<string, string | string[] | undefined>;

@Controller('command-centre')
export class CommandCentreController {
  constructor(
    private readonly commandCentre: CommandCentreService,
    private readonly deviceSales: CommandCentreDeviceSalesService,
  ) {}

  @Get('events/:eventId')
  async snapshot(@Headers() headers: HeadersRecord, @Param('eventId') eventId: string) {
    const normalizedEventId = uuid(eventId, 'eventId');
    const snapshot = await this.commandCentre.snapshot(
      adminContextFromHeaders(headers),
      normalizedEventId,
    );
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
    return this.commandCentre.stream(
      adminContextFromHeaders(headers),
      uuid(eventId, 'eventId'),
    );
  }

  @Post('events/:eventId/inventory-alerts/:alertId/actions')
  actOnInventoryAlert(
    @Headers() headers: HeadersRecord,
    @Param('eventId') eventId: string,
    @Param('alertId') alertId: string,
    @Body() body: unknown,
  ) {
    const normalizedAlertId = alertId.trim();
    if (!normalizedAlertId) throw new BadRequestException('alertId must not be empty');
    const context = adminContextFromHeaders(headers);
    const requested = parseInventoryAlertAction(body);
    const action =
      requested.action === 'ASSIGN'
        ? { action: 'ASSIGN' as const, assignedActorId: context.actorId }
        : requested;
    return this.commandCentre.actOnInventoryAlert(
      context,
      uuid(eventId, 'eventId'),
      normalizedAlertId,
      action,
    );
  }
}
