import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import type { InventoryEdgeAck } from '@event-commerce/contracts';
import { InventoryService } from './inventory.service';
import { parseInventoryEdgeBatch } from './inventory-validation';

@Controller('inventory')
export class InventoryController {
  constructor(@Inject(InventoryService) private readonly inventory: InventoryService) {}

  @Post('edge-events')
  ingest(@Body() body: unknown): Promise<InventoryEdgeAck> {
    return this.inventory.ingest(parseInventoryEdgeBatch(body));
  }

  @Get('events/:eventId/operations')
  operations(@Param('eventId') eventId: string) {
    return this.inventory.operations(eventId);
  }
}
