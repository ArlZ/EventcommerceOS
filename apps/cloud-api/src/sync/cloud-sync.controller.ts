import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Post,
  Req,
} from '@nestjs/common';
import type {
  AuthenticatedEdgePrincipal,
  EdgeCloudAck,
  EdgeCloudBatch,
} from '@event-commerce/contracts';
import { SecurityRoute } from '../security/security-route';
import { CloudSyncService } from './cloud-sync.service';
import { parseEdgeBatch } from './sync-validation';

interface SecurityRequest {
  securityPrincipal?: AuthenticatedEdgePrincipal;
}

@Controller('sync')
export class CloudSyncController {
  constructor(@Inject(CloudSyncService) private readonly sync: CloudSyncService) {}

  @Post('edge-events')
  @SecurityRoute('EDGE_SERVICE')
  async ingest(@Req() request: SecurityRequest, @Body() body: unknown): Promise<EdgeCloudAck> {
    const principal = request.securityPrincipal;
    if (!principal || principal.principalType !== 'EDGE_SERVICE') {
      throw new ForbiddenException('Authenticated Event Edge principal required');
    }
    const batch = parseEdgeBatch(body);
    this.assertScope(principal, batch);
    return this.sync.ingest(batch);
  }

  @Get('devices')
  async devices() {
    return this.sync.deviceHealth();
  }

  private assertScope(principal: AuthenticatedEdgePrincipal, batch: EdgeCloudBatch): void {
    if (batch.edgeId !== principal.edgeId) {
      throw new ForbiddenException('Event Edge credential cannot claim another edgeId');
    }
    for (const event of batch.events) {
      const businessEventId = event.payload.eventId;
      if (typeof businessEventId !== 'string' || businessEventId !== principal.eventId) {
        throw new ForbiddenException('Event Edge credential cannot submit another event');
      }
    }
  }
}
