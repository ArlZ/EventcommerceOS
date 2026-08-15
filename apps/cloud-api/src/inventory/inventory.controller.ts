import { Body, Controller, Get, Headers, Inject, Param, Post } from '@nestjs/common';
import type { InventoryEdgeAck } from '@event-commerce/contracts';
import { EdgeCloudAuthService } from '../sync/edge-cloud-auth.service';
import { InventoryService } from './inventory.service';
import { parseInventoryEdgeBatch } from './inventory-validation';

type HeadersRecord = Record<string, string | string[] | undefined>;

@Controller('inventory')
export class InventoryController {
  constructor(
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject(EdgeCloudAuthService) private readonly edgeAuth: EdgeCloudAuthService,
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
  operations(@Param('eventId') eventId: string) {
    return this.inventory.operations(eventId);
  }
}
