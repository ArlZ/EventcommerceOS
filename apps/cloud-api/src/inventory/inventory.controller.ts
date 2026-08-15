import { Body, Controller, Get, Headers, Inject, Param, Post } from '@nestjs/common';
import type { InventoryEdgeAck } from '@event-commerce/contracts';
import { OperatorAuthService, type HeadersRecord } from '../auth/operator-auth.service';
import { EdgeCloudAuthService } from '../sync/edge-cloud-auth.service';
import { InventoryService } from './inventory.service';
import { parseInventoryEdgeBatch } from './inventory-validation';

@Controller('inventory')
export class InventoryController {
  constructor(
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject(EdgeCloudAuthService) private readonly edgeAuth: EdgeCloudAuthService,
    @Inject(OperatorAuthService) private readonly operators: OperatorAuthService,
  ) {}

  @Post('edge-events')
  async ingest(
    @Headers() headers: HeadersRecord,
    @Body() body: unknown,
  ): Promise<InventoryEdgeAck> {
    const identity = await this.edgeAuth.authenticate(headers);
    const batch = parseInventoryEdgeBatch(body);
    await this.edgeAuth.authorizeInventoryBatch(identity, batch);
    const result = await this.inventory.ingest(batch);
    await this.edgeAuth.attributeInventoryBatch(identity, batch);
    return result;
  }

  @Get('events/:eventId/operations')
  async operations(@Headers() headers: HeadersRecord, @Param('eventId') eventId: string) {
    await this.operators.contextForEvent(headers, eventId, [
      'ADMIN',
      'SUPERVISOR',
      'FINANCE',
      'VIEWER',
    ]);
    return this.inventory.operations(eventId);
  }
}
