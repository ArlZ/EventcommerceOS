import { Body, Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import {
  CurrentEdgeOperator,
  OperatorEdgeGuard,
} from '../security/operator-edge-auth.guard';
import {
  OperatorEdgeAuthService,
  type EdgeOperatorIdentity,
} from '../security/operator-edge-auth.service';
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
@UseGuards(OperatorEdgeGuard)
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
    @Inject(OperatorEdgeAuthService)
    private readonly operatorAuth: OperatorEdgeAuthService,
  ) {}

  @Post('configuration/snapshot')
  async installConfiguration(
    @CurrentEdgeOperator() identity: EdgeOperatorIdentity,
    @Body() body: unknown,
  ): Promise<{ status: 'installed' }> {
    this.operatorAuth.requireRole(identity, ['ADMIN', 'PLATFORM_ADMIN']);
    const snapshot = parseInventoryConfiguration(body);
    this.operatorAuth.assertActor(identity, snapshot.sourceActorId);
    await this.configuration.install(snapshot);
    return { status: 'installed' };
  }

  @Post('movements')
  async postMovement(
    @CurrentEdgeOperator() identity: EdgeOperatorIdentity,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    const input = parseManualMovement(body);
    this.operatorAuth.assertActor(identity, input.actorId);
    await this.operatorAuth.assertEventInstalled(input.eventId);
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
  async stock(
    @CurrentEdgeOperator() _identity: EdgeOperatorIdentity,
    @Param('eventId') eventId: string,
  ) {
    await this.operatorAuth.assertEventInstalled(eventId);
    return this.ledger.projection(eventId);
  }

  @Post('transfers')
  async createTransfer(
    @CurrentEdgeOperator() identity: EdgeOperatorIdentity,
    @Body() body: unknown,
  ) {
    const input = parseCreateTransfer(body);
    this.operatorAuth.assertActor(identity, input.actorId);
    await this.operatorAuth.assertEventInstalled(input.eventId);
    return this.transfers.create(input);
  }

  @Post('transfers/:transferId/assign')
  assignTransfer(
    @CurrentEdgeOperator() identity: EdgeOperatorIdentity,
    @Param('transferId') transferId: string,
    @Body() body: unknown,
  ) {
    const input = parseTransferTransition(body);
    this.operatorAuth.assertActor(identity, input.actorId);
    return this.transfers.assign(transferId, input);
  }

  @Post('transfers/:transferId/picking')
  startPicking(
    @CurrentEdgeOperator() identity: EdgeOperatorIdentity,
    @Param('transferId') transferId: string,
    @Body() body: unknown,
  ) {
    const input = parseTransferTransition(body);
    this.operatorAuth.assertActor(identity, input.actorId);
    return this.transfers.startPicking(transferId, input);
  }

  @Post('transfers/:transferId/dispatch')
  async dispatchTransfer(
    @CurrentEdgeOperator() identity: EdgeOperatorIdentity,
    @Param('transferId') transferId: string,
    @Body() body: unknown,
  ) {
    const input = parseTransferDispatch(body);
    this.operatorAuth.assertActor(identity, input.actorId);
    const result = await this.transfers.dispatch(transferId, input);
    await this.evaluateBestEffort(result.eventId);
    return result;
  }

  @Post('transfers/:transferId/receive')
  async receiveTransfer(
    @CurrentEdgeOperator() identity: EdgeOperatorIdentity,
    @Param('transferId') transferId: string,
    @Body() body: unknown,
  ) {
    const input = parseTransferReceipt(body);
    this.operatorAuth.assertActor(identity, input.actorId);
    const result = await this.transfers.receive(transferId, input);
    await this.evaluateBestEffort(result.eventId);
    return result;
  }

  @Post('transfers/:transferId/cancel')
  cancelTransfer(
    @CurrentEdgeOperator() identity: EdgeOperatorIdentity,
    @Param('transferId') transferId: string,
    @Body() body: unknown,
  ) {
    const input = parseTransferTransition(body);
    this.operatorAuth.assertActor(identity, input.actorId);
    return this.transfers.cancel(transferId, input);
  }

  @Get('events/:eventId/transfers')
  async listTransfers(
    @CurrentEdgeOperator() _identity: EdgeOperatorIdentity,
    @Param('eventId') eventId: string,
  ) {
    await this.operatorAuth.assertEventInstalled(eventId);
    return this.transfers.list(eventId);
  }

  @Post('counts')
  async createCount(
    @CurrentEdgeOperator() identity: EdgeOperatorIdentity,
    @Body() body: unknown,
  ) {
    const input = parseCreateStockCount(body);
    this.operatorAuth.assertActor(identity, input.actorId);
    await this.operatorAuth.assertEventInstalled(input.eventId);
    return this.counts.create(input);
  }

  @Post('counts/:countId/close')
  async closeCount(
    @CurrentEdgeOperator() identity: EdgeOperatorIdentity,
    @Param('countId') countId: string,
    @Body() body: unknown,
  ) {
    const input = parseCloseStockCount(body);
    this.operatorAuth.assertActor(identity, input.actorId);
    const result = await this.counts.close(countId, input);
    await this.evaluateBestEffort(result.eventId);
    return result;
  }

  @Post('events/:eventId/evaluate-alerts')
  async evaluateAlerts(
    @CurrentEdgeOperator() identity: EdgeOperatorIdentity,
    @Param('eventId') eventId: string,
  ): Promise<{ status: 'evaluated' }> {
    this.operatorAuth.requireRole(identity, ['SUPERVISOR', 'ADMIN', 'PLATFORM_ADMIN']);
    await this.operatorAuth.assertEventInstalled(eventId);
    await this.alerts.evaluateEvent(eventId);
    return { status: 'evaluated' };
  }

  @Get('events/:eventId/alerts')
  async listAlerts(
    @CurrentEdgeOperator() _identity: EdgeOperatorIdentity,
    @Param('eventId') eventId: string,
  ) {
    await this.operatorAuth.assertEventInstalled(eventId);
    return this.alerts.list(eventId);
  }

  @Post('alerts/:alertId/transition')
  transitionAlert(
    @CurrentEdgeOperator() identity: EdgeOperatorIdentity,
    @Param('alertId') alertId: string,
    @Body() body: unknown,
  ) {
    const input = parseAlertTransition(body);
    this.operatorAuth.assertActor(identity, input.actorId);
    return this.alerts.transition(alertId, input);
  }

  @Post('events/:eventId/run-escalations')
  async runEscalations(
    @CurrentEdgeOperator() identity: EdgeOperatorIdentity,
    @Param('eventId') eventId: string,
  ): Promise<{ escalated: number }> {
    this.operatorAuth.requireRole(identity, ['SUPERVISOR', 'ADMIN', 'PLATFORM_ADMIN']);
    await this.operatorAuth.assertEventInstalled(eventId);
    return { escalated: await this.alerts.runEscalations(eventId) };
  }

  @Post('notifications/drain')
  drainNotifications(@CurrentEdgeOperator() identity: EdgeOperatorIdentity) {
    this.operatorAuth.requireRole(identity, ['ADMIN', 'PLATFORM_ADMIN']);
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
