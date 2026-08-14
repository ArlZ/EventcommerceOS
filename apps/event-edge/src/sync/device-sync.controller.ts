import {
  Body,
  Controller,
  ForbiddenException,
  Inject,
  Post,
  Req,
} from '@nestjs/common';
import type {
  AuthenticatedDevicePrincipal,
  DeviceSyncAck,
  DeviceSyncBatch,
} from '@event-commerce/contracts';
import { InventoryAlertService } from '../inventory/inventory-alert.service';
import { InventorySaleConsumerService } from '../inventory/inventory-sale-consumer.service';
import { EdgeRoute } from '../security/security-route';
import { DeviceSyncService } from './device-sync.service';
import { parseDeviceBatch } from './sync-validation';

interface SecurityRequest {
  securityPrincipal?: AuthenticatedDevicePrincipal;
}

@Controller('sync')
export class DeviceSyncController {
  constructor(
    @Inject(DeviceSyncService) private readonly sync: DeviceSyncService,
    @Inject(InventorySaleConsumerService)
    private readonly inventorySales: InventorySaleConsumerService,
    @Inject(InventoryAlertService) private readonly inventoryAlerts: InventoryAlertService,
  ) {}

  @Post('device-events')
  @EdgeRoute('DEVICE')
  async ingest(
    @Req() request: SecurityRequest,
    @Body() body: unknown,
  ): Promise<DeviceSyncAck> {
    const principal = request.securityPrincipal;
    if (!principal || principal.principalType !== 'DEVICE') {
      throw new ForbiddenException('Authenticated device principal required');
    }
    const batch = parseDeviceBatch(body);
    this.assertScope(principal, batch);
    const acknowledgement = await this.sync.ingest(batch);
    const processableEventIds = new Set(
      acknowledgement.receipts
        .filter((receipt) => receipt.status !== 'CONFLICT')
        .map((receipt) => receipt.eventInstanceId),
    );
    const inventoryEvents = batch.events.filter((event) =>
      processableEventIds.has(event.eventInstanceId),
    );
    const affectedEvents = await this.inventorySales.consume(inventoryEvents);
    for (const eventId of affectedEvents) {
      void this.inventoryAlerts.evaluateEvent(eventId).catch(() => undefined);
    }
    return acknowledgement;
  }

  private assertScope(
    principal: AuthenticatedDevicePrincipal,
    batch: DeviceSyncBatch,
  ): void {
    if (batch.deviceId !== principal.deviceId) {
      throw new ForbiddenException('Device credential cannot claim another deviceId');
    }
    for (const event of batch.events) {
      if (event.deviceId !== principal.deviceId) {
        throw new ForbiddenException('Device credential cannot submit another device event');
      }
      const eventId = event.payload.eventId;
      if (typeof eventId !== 'string' || eventId !== principal.eventId) {
        throw new ForbiddenException('Device credential cannot submit another event');
      }
      const salesLocationId = event.payload.salesLocationId;
      if (
        salesLocationId !== undefined &&
        salesLocationId !== principal.salesLocationId
      ) {
        throw new ForbiddenException('Device credential cannot submit another sales location');
      }
    }
  }
}
