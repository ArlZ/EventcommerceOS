import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Sse } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { adminContextFromHeaders } from '../configuration/admin-context';
import { uuid } from '../configuration/validation';
import { CommandCentreService } from './command-centre.service';
import { parseInventoryAlertAction } from './command-centre-validation';

type HeadersRecord = Record<string, string | string[] | undefined>;

@Controller('command-centre')
export class CommandCentreController {
  constructor(private readonly commandCentre: CommandCentreService) {}

  @Get('events/:eventId')
  snapshot(@Headers() headers: HeadersRecord, @Param('eventId') eventId: string) {
    return this.commandCentre.snapshot(
      adminContextFromHeaders(headers),
      uuid(eventId, 'eventId'),
    );
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
    return this.commandCentre.actOnInventoryAlert(
      adminContextFromHeaders(headers),
      uuid(eventId, 'eventId'),
      normalizedAlertId,
      parseInventoryAlertAction(body),
    );
  }
}
