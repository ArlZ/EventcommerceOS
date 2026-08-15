import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CommerceOrderAdjustmentView,
  DeclareEventCashRequest,
  DeclareInventoryUnitCostRequest,
  EventCashDeclarationView,
  InventoryUnitCostDeclarationView,
  RecordCommerceOrderAdjustmentRequest,
} from '@event-commerce/contracts';
import type { PoolClient, QueryResultRow } from 'pg';
import { assertOrganisationAccess, type AdminContext } from '../configuration/admin-context';
import { DatabaseService } from '../database/database.service';

interface EventRow extends QueryResultRow {
  id: string;
  organisation_id: string;
}

interface OrderRow extends QueryResultRow {
  event_id: string;
  state: string;
  total_minor: string;
  currency: string;
  device_id: string;
  cashier_id: string | null;
  close_method: string | null;
}

interface AdjustmentRow extends QueryResultRow {
  id: string;
  event_id: string;
  order_id: string;
  kind: 'DISCOUNT' | 'COMP' | 'VOID' | 'CASH_REFUND';
  amount_minor: string;
  currency: string;
  actor_id: string;
  device_id: string | null;
  cashier_id: string | null;
  reason: string;
  idempotency_key: string;
  created_at: Date | string;
}

interface CashRow extends QueryResultRow {
  id: string;
  event_id: string;
  sales_location_id: string;
  device_id: string | null;
  cashier_id: string | null;
  currency: string;
  declared_minor: string;
  actor_id: string;
  reason: string;
  idempotency_key: string;
  declared_at: Date | string;
}

interface CostRow extends QueryResultRow {
  id: string;
  event_id: string;
  sku_id: string;
  currency: string;
  unit_cost_minor: string;
  actor_id: string;
  reason: string;
  idempotency_key: string;
  declared_at: Date | string;
}

interface CloseActionRow extends QueryResultRow {
  action: 'OPERATIONALLY_CLOSE' | 'REOPEN';
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function adjustmentView(row: AdjustmentRow): CommerceOrderAdjustmentView {
  return {
    adjustmentId: row.id,
    eventId: row.event_id,
    orderId: row.order_id,
    kind: row.kind,
    amountMinor: row.amount_minor,
    currency: row.currency,
    actorId: row.actor_id,
    deviceId: row.device_id,
    cashierId: row.cashier_id,
    reason: row.reason,
    idempotencyKey: row.idempotency_key,
    createdAt: iso(row.created_at),
  };
}

function cashView(row: CashRow): EventCashDeclarationView {
  return {
    declarationId: row.id,
    eventId: row.event_id,
    salesLocationId: row.sales_location_id,
    deviceId: row.device_id,
    cashierId: row.cashier_id,
    currency: row.currency,
    declaredMinor: row.declared_minor,
    actorId: row.actor_id,
    reason: row.reason,
    idempotencyKey: row.idempotency_key,
    declaredAt: iso(row.declared_at),
  };
}

function costView(row: CostRow): InventoryUnitCostDeclarationView {
  return {
    declarationId: row.id,
    eventId: row.event_id,
    skuId: row.sku_id,
    currency: row.currency,
    unitCostMinor: row.unit_cost_minor,
    actorId: row.actor_id,
    reason: row.reason,
    idempotencyKey: row.idempotency_key,
    declaredAt: iso(row.declared_at),
  };
}

@Injectable()
export class EventCloseLedgerService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async recordOrderAdjustment(
    context: AdminContext,
    eventId: string,
    request: RecordCommerceOrderAdjustmentRequest,
  ): Promise<CommerceOrderAdjustmentView> {
    const event = await this.eventFor(context, eventId);
    return this.database.transaction(async (client) => {
      await this.lockEventClose(client, eventId);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `event-close-order:${request.orderId}`,
      ]);
      const existing = await this.adjustmentByIdempotency(client, request.idempotencyKey);
      if (existing) {
        this.assertSameAdjustment(existing, eventId, context, request);
        return adjustmentView(existing);
      }
      await this.assertCorrectionWindowOpen(client, eventId);
      const sameId = await this.adjustmentById(client, request.adjustmentId);
      if (sameId) throw new ConflictException('adjustmentId is already in use');

      const orderResult = await client.query<OrderRow>(
        `SELECT event_id,state,total_minor::text,currency,device_id,cashier_id,close_method
         FROM sync_order_state WHERE order_id=$1 FOR UPDATE`,
        [request.orderId],
      );
      const order = orderResult.rows[0];
      if (!order || order.event_id !== eventId) {
        throw new NotFoundException('Closed order not found for event');
      }
      if (order.state !== 'CLOSED') throw new ConflictException('Only closed orders can be adjusted');
      if (order.currency !== request.currency) {
        throw new ConflictException('Adjustment currency must match the order');
      }

      const reserved = await client.query<{
        sale_reductions: string;
        cash_refunds: string;
      }>(
        `SELECT
           coalesce(sum(amount_minor) FILTER (WHERE kind IN ('DISCOUNT','COMP','VOID')),0)::text AS sale_reductions,
           coalesce(sum(amount_minor) FILTER (WHERE kind='CASH_REFUND'),0)::text AS cash_refunds
         FROM commerce_order_adjustments WHERE order_id=$1`,
        [request.orderId],
      );
      const gross = BigInt(order.total_minor);
      const saleReductions = BigInt(reserved.rows[0]?.sale_reductions ?? '0');
      const cashRefunds = BigInt(reserved.rows[0]?.cash_refunds ?? '0');
      const amount = BigInt(request.amountMinor);

      if (request.kind === 'CASH_REFUND') {
        if (order.close_method !== 'CASH') {
          throw new ConflictException('CASH_REFUND requires an order closed as cash');
        }
        if (cashRefunds + amount > gross - saleReductions) {
          throw new ConflictException('Cash refunds cannot exceed remaining cash order value');
        }
      } else if (saleReductions + amount > gross) {
        throw new ConflictException('Discounts, comps and voids cannot exceed order gross value');
      }

      const inserted = await client.query<AdjustmentRow>(
        `INSERT INTO commerce_order_adjustments(
           id,organisation_id,event_id,order_id,kind,amount_minor,currency,actor_id,
           device_id,cashier_id,reason,idempotency_key
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id,event_id::text,order_id,kind,amount_minor::text,currency,actor_id::text,
                   device_id,cashier_id,reason,idempotency_key,created_at`,
        [
          request.adjustmentId,
          event.organisation_id,
          eventId,
          request.orderId,
          request.kind,
          request.amountMinor,
          request.currency,
          context.actorId,
          order.device_id,
          order.cashier_id,
          request.reason,
          request.idempotencyKey,
        ],
      );
      return adjustmentView(inserted.rows[0]!);
    });
  }

  async declareCash(
    context: AdminContext,
    eventId: string,
    request: DeclareEventCashRequest,
  ): Promise<EventCashDeclarationView> {
    const event = await this.eventFor(context, eventId);
    return this.database.transaction(async (client) => {
      await this.lockEventClose(client, eventId);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `event-close-cash:${eventId}:${request.salesLocationId}:${request.deviceId ?? ''}:${request.cashierId ?? ''}:${request.currency}`,
      ]);
      const existing = await this.cashByIdempotency(client, request.idempotencyKey);
      if (existing) {
        this.assertSameCash(existing, eventId, context, request);
        return cashView(existing);
      }
      await this.assertCorrectionWindowOpen(client, eventId);
      const sameId = await this.cashById(client, request.declarationId);
      if (sameId) throw new ConflictException('declarationId is already in use');

      const location = await client.query<{ id: string }>(
        `SELECT id::text FROM sales_locations
         WHERE id=$1 AND event_id=$2 AND organisation_id=$3`,
        [request.salesLocationId, eventId, event.organisation_id],
      );
      if (location.rowCount !== 1) throw new NotFoundException('Sales location not found for event');

      const inserted = await client.query<CashRow>(
        `INSERT INTO event_cash_declarations(
           id,organisation_id,event_id,sales_location_id,device_id,cashier_id,currency,
           declared_minor,actor_id,reason,idempotency_key
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING id,event_id::text,sales_location_id::text,device_id,cashier_id,currency,
                   declared_minor::text,actor_id::text,reason,idempotency_key,declared_at`,
        [
          request.declarationId,
          event.organisation_id,
          eventId,
          request.salesLocationId,
          request.deviceId ?? null,
          request.cashierId ?? null,
          request.currency,
          request.declaredMinor,
          context.actorId,
          request.reason,
          request.idempotencyKey,
        ],
      );
      return cashView(inserted.rows[0]!);
    });
  }

  async declareInventoryCost(
    context: AdminContext,
    eventId: string,
    request: DeclareInventoryUnitCostRequest,
  ): Promise<InventoryUnitCostDeclarationView> {
    const event = await this.eventFor(context, eventId);
    return this.database.transaction(async (client) => {
      await this.lockEventClose(client, eventId);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `event-close-cost:${eventId}:${request.skuId}`,
      ]);
      const existing = await this.costByIdempotency(client, request.idempotencyKey);
      if (existing) {
        this.assertSameCost(existing, eventId, context, request);
        return costView(existing);
      }
      await this.assertCorrectionWindowOpen(client, eventId);
      const sameId = await this.costById(client, request.declarationId);
      if (sameId) throw new ConflictException('declarationId is already in use');

      const sku = await client.query<{ id: string }>(
        `SELECT id::text FROM skus WHERE id=$1 AND organisation_id=$2`,
        [request.skuId, event.organisation_id],
      );
      if (sku.rowCount !== 1) throw new NotFoundException('SKU not found for organisation');

      const inserted = await client.query<CostRow>(
        `INSERT INTO event_inventory_unit_cost_declarations(
           id,organisation_id,event_id,sku_id,currency,unit_cost_minor,actor_id,reason,idempotency_key
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id,event_id::text,sku_id::text,currency,unit_cost_minor::text,actor_id::text,
                   reason,idempotency_key,declared_at`,
        [
          request.declarationId,
          event.organisation_id,
          eventId,
          request.skuId,
          request.currency,
          request.unitCostMinor,
          context.actorId,
          request.reason,
          request.idempotencyKey,
        ],
      );
      return costView(inserted.rows[0]!);
    });
  }

  private async lockEventClose(client: PoolClient, eventId: string): Promise<void> {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`event-close:${eventId}`]);
  }

  private async assertCorrectionWindowOpen(client: PoolClient, eventId: string): Promise<void> {
    const result = await client.query<CloseActionRow>(
      `SELECT action FROM event_close_actions
       WHERE event_id=$1
       ORDER BY created_at DESC,id DESC
       LIMIT 1`,
      [eventId],
    );
    if (result.rows[0]?.action === 'OPERATIONALLY_CLOSE') {
      throw new ConflictException(
        'event is operationally closed; reopen before recording a new close correction',
      );
    }
  }

  private async eventFor(context: AdminContext, eventId: string): Promise<EventRow> {
    const rows = await this.database.query<EventRow>(
      'SELECT id::text,organisation_id::text FROM events WHERE id=$1',
      [eventId],
    );
    const event = rows[0];
    if (!event) throw new NotFoundException('Event not found');
    assertOrganisationAccess(context, event.organisation_id);
    return event;
  }

  private async adjustmentByIdempotency(
    client: PoolClient,
    idempotencyKey: string,
  ): Promise<AdjustmentRow | undefined> {
    const result = await client.query<AdjustmentRow>(
      `${this.adjustmentSelect()} WHERE idempotency_key=$1 FOR UPDATE`,
      [idempotencyKey],
    );
    return result.rows[0];
  }

  private async adjustmentById(
    client: PoolClient,
    id: string,
  ): Promise<AdjustmentRow | undefined> {
    const result = await client.query<AdjustmentRow>(
      `${this.adjustmentSelect()} WHERE id=$1 FOR UPDATE`,
      [id],
    );
    return result.rows[0];
  }

  private adjustmentSelect(): string {
    return `SELECT id,event_id::text,order_id,kind,amount_minor::text,currency,actor_id::text,
                   device_id,cashier_id,reason,idempotency_key,created_at
            FROM commerce_order_adjustments`;
  }

  private assertSameAdjustment(
    row: AdjustmentRow,
    eventId: string,
    context: AdminContext,
    request: RecordCommerceOrderAdjustmentRequest,
  ): void {
    if (
      row.id !== request.adjustmentId ||
      row.event_id !== eventId ||
      row.order_id !== request.orderId ||
      row.kind !== request.kind ||
      row.amount_minor !== String(request.amountMinor) ||
      row.currency !== request.currency ||
      row.actor_id !== context.actorId ||
      row.reason !== request.reason
    ) {
      throw new ConflictException('Adjustment idempotency key was reused for different content');
    }
  }

  private async cashByIdempotency(client: PoolClient, key: string): Promise<CashRow | undefined> {
    const result = await client.query<CashRow>(
      `${this.cashSelect()} WHERE idempotency_key=$1 FOR UPDATE`,
      [key],
    );
    return result.rows[0];
  }

  private async cashById(client: PoolClient, id: string): Promise<CashRow | undefined> {
    const result = await client.query<CashRow>(`${this.cashSelect()} WHERE id=$1 FOR UPDATE`, [id]);
    return result.rows[0];
  }

  private cashSelect(): string {
    return `SELECT id,event_id::text,sales_location_id::text,device_id,cashier_id,currency,
                   declared_minor::text,actor_id::text,reason,idempotency_key,declared_at
            FROM event_cash_declarations`;
  }

  private assertSameCash(
    row: CashRow,
    eventId: string,
    context: AdminContext,
    request: DeclareEventCashRequest,
  ): void {
    if (
      row.id !== request.declarationId ||
      row.event_id !== eventId ||
      row.sales_location_id !== request.salesLocationId ||
      (row.device_id ?? null) !== (request.deviceId ?? null) ||
      (row.cashier_id ?? null) !== (request.cashierId ?? null) ||
      row.currency !== request.currency ||
      row.declared_minor !== String(request.declaredMinor) ||
      row.actor_id !== context.actorId ||
      row.reason !== request.reason
    ) {
      throw new ConflictException('Cash declaration idempotency key was reused for different content');
    }
  }

  private async costByIdempotency(client: PoolClient, key: string): Promise<CostRow | undefined> {
    const result = await client.query<CostRow>(
      `${this.costSelect()} WHERE idempotency_key=$1 FOR UPDATE`,
      [key],
    );
    return result.rows[0];
  }

  private async costById(client: PoolClient, id: string): Promise<CostRow | undefined> {
    const result = await client.query<CostRow>(`${this.costSelect()} WHERE id=$1 FOR UPDATE`, [id]);
    return result.rows[0];
  }

  private costSelect(): string {
    return `SELECT id,event_id::text,sku_id::text,currency,unit_cost_minor::text,actor_id::text,
                   reason,idempotency_key,declared_at
            FROM event_inventory_unit_cost_declarations`;
  }

  private assertSameCost(
    row: CostRow,
    eventId: string,
    context: AdminContext,
    request: DeclareInventoryUnitCostRequest,
  ): void {
    if (
      row.id !== request.declarationId ||
      row.event_id !== eventId ||
      row.sku_id !== request.skuId ||
      row.currency !== request.currency ||
      row.unit_cost_minor !== String(request.unitCostMinor) ||
      row.actor_id !== context.actorId ||
      row.reason !== request.reason
    ) {
      throw new ConflictException('Inventory cost idempotency key was reused for different content');
    }
  }
}
