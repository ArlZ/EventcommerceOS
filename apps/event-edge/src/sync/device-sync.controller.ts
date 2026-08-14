import { Body, Controller, Inject, Post } from '@nestjs/common';
import type { DeviceSyncAck } from '@event-commerce/contracts';
import { InventoryAlertService } from '../inventory/inventory-alert.service';
import { InventorySaleConsumerService } from '../inventory/inventory-sale-consumer.service';
import { DeviceSyncService } from './device-sync.service';
import { parseDeviceBatch } from './sync-validation';

@Controller('sync')
export class DeviceSyncController {
  constructor(
    @Inject(DeviceSyncService) private readonly sync: DeviceSyncService,
    @Inject(InventorySaleConsumerService)
    private readonly inventorySales: InventorySaleConsumerService,
    @Inject(InventoryAlertService) private readonly inventoryAlerts: InventoryAlertService,
  ) {}

  @Post('device-events')
  async ingest(@Body() body: unknown): Promise<DeviceSyncAck> {
    const batch = parseDeviceBatch(body);
    const acknowledgement = await this.sync.ingest(batch);
    const affectedEvents = await this.inventorySales.consume(batch.events);
    for (const eventId of affectedEvents) {
      void this.inventoryAlerts.evaluateEvent(eventId).catch(() => undefined);
    }
    return acknowledgement;
  }
}
