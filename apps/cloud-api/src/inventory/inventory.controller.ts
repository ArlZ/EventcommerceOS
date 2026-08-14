import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { InventoryEdgeAck } from '@event-commerce/contracts';
import { CurrentOperator, OperatorGuard } from '../auth/operator-auth.guard';
import { OperatorAuthService, type OperatorIdentity } from '../auth/operator-auth.service';
import { EdgeCloudAuthService } from '../sync/edge-cloud-auth.service';
import { InventoryService } from './inventory.service';
import { parseInventoryEdgeBatch } from './inventory-validation';

type HeadersRecord = Record<string, string | string[] | undefined>;

@Controller('inventory')
export class InventoryController {
  constructor(
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject(EdgeCloudAuthService) private readonly edgeAuth: EdgeCloudAuthService,
    @Inject(OperatorAuthService) private readonly operatorAuth: OperatorAuthService,
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
  @UseGuards(OperatorGuard)
  async operations(
    @CurrentOperator() identity: OperatorIdentity,
    @Param('eventId') eventId: string,
  ) {
    this.operatorAuth.requireRole(identity, ['SUPERVISOR', 'ADMIN', 'PLATFORM_ADMIN']);
    await this.operatorAuth.assertEventAccess(identity, eventId);
    return this.inventory.operations(eventId);
  }
}
