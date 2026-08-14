import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type {
  AuthenticatedEdgePrincipal,
  InventoryEdgeAck,
  InventoryEdgeBatch,
} from '@event-commerce/contracts';
import { SecurityRoute } from '../security/security-route';
import { InventoryService } from './inventory.service';
import { parseInventoryEdgeBatch } from './inventory-validation';

interface SecurityRequest {
  securityPrincipal?: AuthenticatedEdgePrincipal;
}

@Controller('inventory')
export class InventoryController {
  constructor(@Inject(InventoryService) private readonly inventory: InventoryService) {}

  @Post('edge-events')
  @SecurityRoute('EDGE_SERVICE')
  ingest(@Req() request: SecurityRequest, @Body() body: unknown): Promise<InventoryEdgeAck> {
    const principal = request.securityPrincipal;
    if (!principal || principal.principalType !== 'EDGE_SERVICE') {
      throw new ForbiddenException('Authenticated Event Edge principal required');
    }
    const batch = parseInventoryEdgeBatch(body);
    this.assertScope(principal, batch);
    return this.inventory.ingest(batch);
  }

  @Get('events/:eventId/operations')
  operations(@Param('eventId') eventId: string) {
    return this.inventory.operations(eventId);
  }

  private assertScope(principal: AuthenticatedEdgePrincipal, batch: InventoryEdgeBatch): void {
    if (batch.edgeId !== principal.edgeId) {
      throw new ForbiddenException('Event Edge credential cannot claim another edgeId');
    }
    for (const event of batch.events) {
      const businessEventId = event.payload.eventId;
      if (typeof businessEventId !== 'string' || businessEventId !== principal.eventId) {
        throw new ForbiddenException('Event Edge credential cannot submit inventory for another event');
      }
    }
  }
}
