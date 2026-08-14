import { Body, Controller, Headers, Inject, Post } from '@nestjs/common';
import type { DeviceSyncAck } from '@event-commerce/contracts';
import { InventoryAlertService } from '../inventory/inventory-alert.service';
import { InventorySaleConsumerService } from '../inventory/inventory-sale-consumer.service';
import { DeviceEdgeAuthService } from '../security/device-edge-auth.service';
import { DeviceSyncService } from './device-sync.service';
import { parseDeviceBatch } from './sync-validation';

type HeadersRecord = Record<string, string | string[] | undefined>;

@Controller('sync')
export class DeviceSyncController {
  constructor(
    @Inject(DeviceSyncService) private readonly sync: DeviceSyncService,
    @Inject(InventorySaleConsumerService)
    private readonly inventorySales: InventorySaleConsumerService,
    @Inject(InventoryAlertService) private readonly inventoryAlerts: InventoryAlertService,
    @Inject(DeviceEdgeAuthService) private readonly deviceAuth: DeviceEdgeAuthService,
  ) {}

  @Post('device-events')
  async ingest(
    @Headers() headers: HeadersRecord,
    @Body() body: unknown,
  ): Promise<DeviceSyncAck> {
    const identity = await this.deviceAuth.authenticate(headers);
    const batch = parseDeviceBatch(body);
    this.deviceAuth.authorizeSyncBatch(identity, batch);
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
}
