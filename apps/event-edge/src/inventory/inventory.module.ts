import { Module } from '@nestjs/common';
import { InventoryAlertService } from './inventory-alert.service';
import { InventoryAuthorizationService } from './inventory-authorization.service';
import { InventoryCloudForwarderService } from './inventory-cloud-forwarder.service';
import { InventoryCloudTransport } from './inventory-cloud.transport';
import { InventoryConfigurationService } from './inventory-configuration.service';
import { InventoryController } from './inventory.controller';
import { InventoryCountService } from './inventory-count.service';
import { HttpInventoryCloudTransport } from './http-inventory-cloud.transport';
import { InventoryLedgerService } from './inventory-ledger.service';
import { InventoryNotificationService } from './inventory-notification.service';
import { InventoryOperationsLoopService } from './inventory-operations-loop.service';
import {
  InventoryNotificationTransport,
  StubInventoryNotificationTransport,
} from './inventory-notification.transport';
import { InventorySaleConsumerService } from './inventory-sale-consumer.service';
import { InventoryTransferService } from './inventory-transfer.service';

@Module({
  controllers: [InventoryController],
  providers: [
    InventoryAuthorizationService,
    InventoryConfigurationService,
    InventoryLedgerService,
    InventorySaleConsumerService,
    InventoryTransferService,
    InventoryCountService,
    InventoryAlertService,
    InventoryNotificationService,
    InventoryOperationsLoopService,
    InventoryCloudForwarderService,
    { provide: InventoryCloudTransport, useClass: HttpInventoryCloudTransport },
    { provide: InventoryNotificationTransport, useClass: StubInventoryNotificationTransport },
  ],
  exports: [InventorySaleConsumerService, InventoryAlertService, InventoryCloudForwarderService],
})
export class InventoryModule {}
