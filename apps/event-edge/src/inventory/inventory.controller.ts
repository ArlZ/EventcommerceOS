import { Inject, Body, Controller, Get, Param, Post } from '@nestjs/common';
import { InventoryAlertService } from './inventory-alert.service';
import { InventoryConfigurationService } from './inventory-configuration.service';
import { InventoryCountService } from './inventory-count.service';
import { InventoryLedgerService } from './inventory-ledger.service';
import { InventoryNotificationService } from './inventory-notification.service';
import { InventoryTransferService } from './inventory-transfer.service';
import {
  parseAlertTransition,
  parseCloseStockCount,
  parseCreateStockCount,
  parseCreateTransfer,
  parseInventoryConfiguration,
  parseManualMovement,
  parseTransferDispatch,
  parseTransferReceipt,
  parseTransferTransition,
} from './inventory.validation';

@Controller('inventory')
export class InventoryController {
  constructor(
    @Inject(InventoryConfigurationService)
    private readonly configuration: InventoryConfigurationService,
    @Inject(InventoryLedgerService) private readonly ledger: InventoryLedgerService,
    @Inject(InventoryTransferService) private readonly transfers: InventoryTransferService,
    @Inject(InventoryCountService) private readonly counts: InventoryCountService,
    @Inject(InventoryAlertService) private readonly alerts: InventoryAlertService,
    @Inject(InventoryNotificationService)
    private readonly notifications: InventoryNotificationService,
  ) {}

  @Post('configuration/snapshot')
  async installConfiguration(@Body() body: unknown): Promise<{ status: 'installed' }> {
    await this.configuration.install(parseInventoryConfiguration(body));
    return { status: 'installed' };
  }

  @Post('movements')
  async postMovement(@Body() body: unknown): Promise<Record<string, unknown>> {
    const input = parseManualMovement(body);
    const row = await this.ledger.postManual(input);
    await this.evaluateBestEffort(input.eventId);
    return {
      id: row.id,
      eventId: row.event_id,
      inventoryLocationId: row.inventory_location_id,
      skuId: row.sku_id,
      movementType: row.movement_type,
      quantityDeltaBase: row.quantity_delta,
      occurredAt: row.occurred_at.toISOString(),
    };
  }

  @Get('events/:eventId/stock')
  stock(@Param('eventId') eventId: string) {
    return this.ledger.projection(eventId);
  }

  @Post('transfers')
  createTransfer(@Body() body: unknown) {
    return this.transfers.create(parseCreateTransfer(body));
  }

  @Post('transfers/:transferId/assign')
  assignTransfer(@Param('transferId') transferId: string, @Body() body: unknown) {
    return this.transfers.assign(transferId, parseTransferTransition(body));
  }

  @Post('transfers/:transferId/picking')
  startPicking(@Param('transferId') transferId: string, @Body() body: unknown) {
    return this.transfers.startPicking(transferId, parseTransferTransition(body));
  }

  @Post('transfers/:transferId/dispatch')
  async dispatchTransfer(@Param('transferId') transferId: string, @Body() body: unknown) {
    const result = await this.transfers.dispatch(transferId, parseTransferDispatch(body));
    await this.evaluateBestEffort(result.eventId);
    return result;
  }

  @Post('transfers/:transferId/receive')
  async receiveTransfer(@Param('transferId') transferId: string, @Body() body: unknown) {
    const result = await this.transfers.receive(transferId, parseTransferReceipt(body));
    await this.evaluateBestEffort(result.eventId);
    return result;
  }

  @Post('transfers/:transferId/cancel')
  cancelTransfer(@Param('transferId') transferId: string, @Body() body: unknown) {
    return this.transfers.cancel(transferId, parseTransferTransition(body));
  }

  @Get('events/:eventId/transfers')
  listTransfers(@Param('eventId') eventId: string) {
    return this.transfers.list(eventId);
  }

  @Post('counts')
  createCount(@Body() body: unknown) {
    return this.counts.create(parseCreateStockCount(body));
  }

  @Post('counts/:countId/close')
  async closeCount(@Param('countId') countId: string, @Body() body: unknown) {
    const result = await this.counts.close(countId, parseCloseStockCount(body));
    await this.evaluateBestEffort(result.eventId);
    return result;
  }

  @Post('events/:eventId/evaluate-alerts')
  async evaluateAlerts(@Param('eventId') eventId: string): Promise<{ status: 'evaluated' }> {
    await this.alerts.evaluateEvent(eventId);
    return { status: 'evaluated' };
  }

  @Get('events/:eventId/alerts')
  listAlerts(@Param('eventId') eventId: string) {
    return this.alerts.list(eventId);
  }

  @Post('alerts/:alertId/transition')
  transitionAlert(@Param('alertId') alertId: string, @Body() body: unknown) {
    return this.alerts.transition(alertId, parseAlertTransition(body));
  }

  @Post('events/:eventId/run-escalations')
  async runEscalations(@Param('eventId') eventId: string): Promise<{ escalated: number }> {
    return { escalated: await this.alerts.runEscalations(eventId) };
  }

  @Post('notifications/drain')
  drainNotifications() {
    return this.notifications.drainOnce();
  }

  private async evaluateBestEffort(eventId: string): Promise<void> {
    try {
      await this.alerts.evaluateEvent(eventId);
    } catch {
      // Ledger/transfer/count truth is already committed. Alert evaluation is recoverable and periodic.
    }
  }
}
