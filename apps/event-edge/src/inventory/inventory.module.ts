import { Module } from '@nestjs/common';
import { InventoryAlertService } from './inventory-alert.service';
import { InventoryAuthorizationService } from './inventory-authorization.service';
import { InventoryConfigurationService } from './inventory-configuration.service';
import { InventoryController } from './inventory.controller';
import { InventoryCountService } from './inventory-count.service';
import { InventoryLedgerService } from './inventory-ledger.service';
import { InventoryNotificationService } from './inventory-notification.service';
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
    { provide: InventoryNotificationTransport, useClass: StubInventoryNotificationTransport },
  ],
  exports: [InventorySaleConsumerService, InventoryAlertService],
})
export class InventoryModule {}
