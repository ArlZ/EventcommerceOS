import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  CommandCentreAlert,
  CommandCentreAlertSeverity,
  CommandCentreCurrencyAmount,
  CommandCentreCurrencyAverage,
  CommandCentreCurrencyVelocity,
  CommandCentreDeviceMetric,
  CommandCentreInventoryAlertActionRequest,
  CommandCentreInventoryAlertActionView,
  CommandCentreInventoryRisk,
  CommandCentreLocationMetric,
  CommandCentrePaymentAttemptHealth,
  CommandCentrePaymentMethodMetric,
  CommandCentreProductMetric,
  CommandCentreRealtimeEvent,
  CommandCentreSnapshot,
  CommandCentreTransferMetric,
} from '@event-commerce/contracts';
import { timer, from, type Observable } from 'rxjs';
import { distinctUntilChanged, map, switchMap } from 'rxjs/operators';
import type { MessageEvent } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { assertOrganisationAccess, type AdminContext } from '../configuration/admin-context';
import { DatabaseService } from '../database/database.service';
import { PaymentRailService } from '../payments/payment-rail.service';

interface EventRow extends QueryResultRow {
  id: string;
  organisation_id: string;
  name: string;
  timezone: string;
  lifecycle: string;
  starts_at: Date | string;
  ends_at: Date | string;
}

interface SalesRow extends QueryResultRow {
  currency: string;
  transaction_count: string;
  gross_minor: string;
  average_minor: string;
  velocity_minor_per_minute: string;
  last_sale_at: Date | string | null;
}

interface LocationRow extends SalesRow {
  sales_location_id: string;
  name: string;
}

interface ProductRow extends QueryResultRow {
  sku_id: string;
  name: string;
  quantity_sold: string;
  currency: string;
  gross_minor: string;
}

interface AttemptHealthRow extends QueryResultRow {
  currency: string;
  total_count: string;
  pending_count: string;
  unknown_count: string;
  failed_count: string;
  unknown_value_minor: string;
  latest_attempt_at: Date | string | null;
}

interface SettledMethodRow extends QueryResultRow {
  provider_id: string;
  currency: string;
  transaction_count: string;
  value_minor: string;
}

interface InventoryRiskRow extends QueryResultRow {
  id: string;
  alert_type: string;
  severity: string;
  effective_state: string;
  inventory_location_id: string | null;
  inventory_location_name: string | null;
  sku_id: string;
  sku_name: string;
  available_quantity: string;
  minutes_of_cover: string | null;
  suggested_source_location_id: string | null;
  suggested_source_location_name: string | null;
  suggested_transfer_quantity: string | null;
  responsible_actor_id: string | null;
  effective_assigned_actor_id: string | null;
  opened_at: Date | string;
}

interface TransferRow extends QueryResultRow {
  id: string;
  source_location_id: string;
  source_location_name: string | null;
  destination_location_id: string;
  destination_location_name: string | null;
  state: string;
  assigned_actor_id: string | null;
  source_updated_at: Date | string;
}

interface DeviceRow extends QueryResultRow {
  device_id: string;
  sales_location_id: string | null;
  sales_location_name: string | null;
  last_seen_at: Date | string | null;
  last_cloud_delivery_at: Date | string | null;
  edge_backlog_count: number | null;
  sync_age_seconds: number | string | null;
}

interface WatermarkRow extends QueryResultRow {
  latest_source_at: Date | string | null;
  version_token: string;
}

interface AlertActionRow extends QueryResultRow {
  base_state: string;
  control_state: string | null;
  acknowledged_by_actor_id: string | null;
  assigned_actor_id: string | null;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isoNullable(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

function severity(value: string): CommandCentreAlertSeverity {
  if (value === 'CRITICAL') return 'CRITICAL';
  if (value === 'URGENT') return 'URGENT';
  if (value === 'INFO') return 'INFO';
  return 'WARNING';
}

function alertSeverityRank(value: CommandCentreAlertSeverity): number {
  if (value === 'CRITICAL') return 0;
  if (value === 'URGENT') return 1;
  if (value === 'WARNING') return 2;
  return 3;
}

function effectiveInventoryState(base: string, control: string | null): string {
  if (base === 'RESOLVED') return 'RESOLVED';
  if (base === 'ASSIGNED' || control === 'ASSIGNED') return 'ASSIGNED';
  if (base === 'ACKNOWLEDGED' || control === 'ACKNOWLEDGED') return 'ACKNOWLEDGED';
  return base;
}

function rate(part: number, total: number): number {
  return total === 0 ? 0 : Number((part / total).toFixed(4));
}

@Injectable()
export class CommandCentreService {
  private readonly staleAfterSeconds = 30;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PaymentRailService) private readonly rails: PaymentRailService,
  ) {}

  async snapshot(context: AdminContext, eventId: string): Promise<CommandCentreSnapshot> {
    const event = await this.eventFor(context, eventId);
    const generatedAt = new Date();

    const [
      salesRows,
      locationRows,
      productRows,
      attemptRows,
      settledRows,
      inventoryRows,
      transferRows,
      deviceRows,
      watermark,
    ] = await Promise.all([
      this.sales(eventId),
      this.locations(eventId),
      this.products(eventId),
      this.paymentAttemptHealthRows(eventId),
      this.settledPaymentMethods(eventId),
      this.inventoryRisks(eventId),
      this.activeTransfers(eventId),
      this.devices(eventId),
      this.watermark(eventId),
    ]);

    const sales = this.salesSummary(salesRows);
    const locations = this.locationMetrics(locationRows);
    const products = this.productMetrics(productRows);
    const paymentHealth = this.paymentHealth(attemptRows);
    const paymentMethods: CommandCentrePaymentMethodMetric[] = settledRows.map((row) => ({
      providerId: row.provider_id,
      currency: row.currency,
      transactionCount: Number(row.transaction_count),
      valueMinor: row.value_minor,
    }));
    const risks = this.inventoryRiskViews(inventoryRows);
    const transfers = this.transferViews(transferRows);
    const devices = this.deviceViews(deviceRows);
    const railAvailability = this.rails.availability();
    const latestAttemptAt =
      attemptRows
        .map((row) => row.latest_attempt_at)
        .filter((value): value is Date | string => value !== null)
        .map(iso)
        .sort()
        .at(-1) ?? null;
    const alerts = this.alerts(
      risks,
      paymentHealth,
      latestAttemptAt,
      railAvailability,
      devices,
      generatedAt.toISOString(),
    );

    return {
      event: {
        eventId: event.id,
        organisationId: event.organisation_id,
        name: event.name,
        timezone: event.timezone,
        lifecycle: event.lifecycle,
        startsAt: iso(event.starts_at),
        endsAt: iso(event.ends_at),
      },
      freshness: {
        generatedAt: generatedAt.toISOString(),
        staleAfterSeconds: this.staleAfterSeconds,
        latestSourceAt: isoNullable(watermark.latest_source_at),
      },
      sales,
      salesLocations: locations,
      topProducts: products,
      payments: {
        settledMethods: paymentMethods,
        attempts: paymentHealth,
        rails: railAvailability,
      },
      inventory: { risks, activeTransfers: transfers },
      devices,
      alerts,
    };
  }

  stream(context: AdminContext, eventId: string): Observable<MessageEvent> {
    return from(this.eventFor(context, eventId)).pipe(
      switchMap(() =>
        timer(0, 5_000).pipe(
          switchMap(() => from(this.realtimeVersion(eventId))),
          distinctUntilChanged((left, right) => left.versionToken === right.versionToken),
          map((data) => ({ data }) as MessageEvent),
        ),
      ),
    );
  }

  async actOnInventoryAlert(
    context: AdminContext,
    eventId: string,
    alertId: string,
    request: CommandCentreInventoryAlertActionRequest,
  ): Promise<CommandCentreInventoryAlertActionView> {
    const event = await this.eventFor(context, eventId);
    return this.database.transaction(async (client) => {
      const result = await client.query<AlertActionRow>(
        `SELECT ia.state AS base_state,
                control.state AS control_state,
                control.acknowledged_by_actor_id::text AS acknowledged_by_actor_id,
                control.assigned_actor_id::text AS assigned_actor_id
         FROM inventory_alert_projection ia
         LEFT JOIN command_centre_inventory_alert_control control
           ON control.alert_id = ia.id AND control.event_id::text = ia.event_id
         WHERE ia.id = $1 AND ia.event_id = $2
         FOR UPDATE OF ia`,
        [alertId, eventId],
      );
      const row = result.rows[0];
      if (!row) throw new NotFoundException('Inventory alert not found for event');

      const previousState = effectiveInventoryState(row.base_state, row.control_state);
      if (previousState === 'RESOLVED') {
        throw new BadRequestException('Resolved inventory alerts cannot be changed');
      }
      if (request.action === 'ACKNOWLEDGE' && previousState === 'ASSIGNED') {
        throw new BadRequestException('Assigned inventory alert is already acknowledged');
      }
      const resultingState = request.action === 'ASSIGN' ? 'ASSIGNED' : 'ACKNOWLEDGED';
      const assignedActorId =
        request.action === 'ASSIGN' ? (request.assignedActorId ?? null) : row.assigned_actor_id;
      if (request.action === 'ASSIGN' && assignedActorId === null) {
        throw new BadRequestException('assignedActorId is required for ASSIGN');
      }

      await client.query(
        `INSERT INTO command_centre_inventory_alert_control(
           alert_id, organisation_id, event_id, state, acknowledged_by_actor_id,
           assigned_actor_id, updated_by_actor_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (alert_id) DO UPDATE SET
           state = EXCLUDED.state,
           acknowledged_by_actor_id = COALESCE(
             command_centre_inventory_alert_control.acknowledged_by_actor_id,
             EXCLUDED.acknowledged_by_actor_id
           ),
           assigned_actor_id = COALESCE(
             EXCLUDED.assigned_actor_id,
             command_centre_inventory_alert_control.assigned_actor_id
           ),
           updated_by_actor_id = EXCLUDED.updated_by_actor_id,
           updated_at = now()`,
        [
          alertId,
          event.organisation_id,
          eventId,
          resultingState,
          row.acknowledged_by_actor_id ?? context.actorId,
          assignedActorId,
          context.actorId,
        ],
      );

      const auditId = randomUUID();
      const audit = await client.query<{ created_at: Date | string }>(
        `INSERT INTO command_centre_alert_audit(
           id, organisation_id, event_id, alert_id, action, actor_id,
           assigned_actor_id, previous_state, resulting_state
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING created_at`,
        [
          auditId,
          event.organisation_id,
          eventId,
          alertId,
          request.action,
          context.actorId,
          assignedActorId,
          previousState,
          resultingState,
        ],
      );

      return {
        auditId,
        alertId,
        eventId,
        action: request.action,
        previousState,
        resultingState,
        actorId: context.actorId,
        assignedActorId,
        createdAt: iso(audit.rows[0]!.created_at),
      };
    });
  }

  private async eventFor(context: AdminContext, eventId: string): Promise<EventRow> {
    const rows = await this.database.query<EventRow>(
      `SELECT id::text, organisation_id::text, name, timezone, lifecycle, starts_at, ends_at
       FROM events WHERE id = $1`,
      [eventId],
    );
    const event = rows[0];
    if (!event) throw new NotFoundException('Event not found');
    assertOrganisationAccess(context, event.organisation_id);
    return event;
  }

  private async sales(eventId: string): Promise<SalesRow[]> {
    return this.database.query<SalesRow>(
      `SELECT currency,
              count(*)::text AS transaction_count,
              coalesce(sum(total_minor),0)::text AS gross_minor,
              coalesce(round(avg(total_minor)),0)::bigint::text AS average_minor,
              coalesce(round(
                coalesce(sum(total_minor) FILTER (WHERE occurred_at >= now() - interval '15 minutes'),0)::numeric / 15
              ),0)::bigint::text AS velocity_minor_per_minute,
              max(occurred_at) AS last_sale_at
       FROM sync_order_state
       WHERE event_id = $1 AND state = 'CLOSED'
       GROUP BY currency ORDER BY currency`,
      [eventId],
    );
  }

  private async locations(eventId: string): Promise<LocationRow[]> {
    return this.database.query<LocationRow>(
      `SELECT coalesce(state.sales_location_id, 'unassigned') AS sales_location_id,
              coalesce(location.name, 'Unassigned') AS name,
              state.currency,
              count(*)::text AS transaction_count,
              coalesce(sum(state.total_minor),0)::text AS gross_minor,
              coalesce(round(avg(state.total_minor)),0)::bigint::text AS average_minor,
              coalesce(round(
                coalesce(sum(state.total_minor) FILTER (
                  WHERE state.occurred_at >= now() - interval '15 minutes'
                ),0)::numeric / 15
              ),0)::bigint::text AS velocity_minor_per_minute,
              max(state.occurred_at) AS last_sale_at
       FROM sync_order_state state
       LEFT JOIN sales_locations location
         ON location.id::text = state.sales_location_id AND location.event_id::text = $1
       WHERE state.event_id = $1 AND state.state = 'CLOSED'
       GROUP BY state.sales_location_id, location.name, state.currency
       ORDER BY max(state.occurred_at) ASC NULLS FIRST, name, state.currency`,
      [eventId],
    );
  }

  private async products(eventId: string): Promise<ProductRow[]> {
    return this.database.query<ProductRow>(
      `WITH line_sales AS (
         SELECT line->>'skuId' AS sku_id,
                state.currency,
                (line->>'quantity')::bigint AS quantity,
                (line->>'unitPriceMinor')::bigint AS unit_price_minor
         FROM sync_order_state state
         CROSS JOIN LATERAL jsonb_array_elements(state.lines) line
         WHERE state.event_id = $1 AND state.state = 'CLOSED'
       ), top_skus AS (
         SELECT sku_id, sum(quantity) AS total_quantity
         FROM line_sales
         GROUP BY sku_id
         ORDER BY sum(quantity) DESC, sku_id
         LIMIT 10
       )
       SELECT sales.sku_id,
              coalesce(sku.name, sales.sku_id) AS name,
              top_skus.total_quantity::text AS quantity_sold,
              sales.currency,
              sum(sales.quantity * sales.unit_price_minor)::text AS gross_minor
       FROM line_sales sales
       JOIN top_skus ON top_skus.sku_id = sales.sku_id
       LEFT JOIN skus sku ON sku.id::text = sales.sku_id
       GROUP BY sales.sku_id, sku.name, top_skus.total_quantity, sales.currency
       ORDER BY top_skus.total_quantity DESC, sales.sku_id, sales.currency`,
      [eventId],
    );
  }

  private async paymentAttemptHealthRows(eventId: string): Promise<AttemptHealthRow[]> {
    return this.database.query<AttemptHealthRow>(
      `SELECT payment.currency,
              count(*)::text AS total_count,
              count(*) FILTER (WHERE attempt.status IN ('CREATED','INITIATED','PENDING'))::text AS pending_count,
              count(*) FILTER (WHERE attempt.status = 'UNKNOWN')::text AS unknown_count,
              count(*) FILTER (WHERE attempt.status = 'FAILED')::text AS failed_count,
              coalesce(sum(payment.amount_minor) FILTER (WHERE attempt.status = 'UNKNOWN'),0)::text AS unknown_value_minor,
              max(attempt.updated_at) AS latest_attempt_at
       FROM payments payment
       JOIN payment_attempts attempt ON attempt.payment_id = payment.id
       WHERE payment.event_id = $1
       GROUP BY payment.currency ORDER BY payment.currency`,
      [eventId],
    );
  }

  private async settledPaymentMethods(eventId: string): Promise<SettledMethodRow[]> {
    return this.database.query<SettledMethodRow>(
      `WITH settled AS (
         SELECT DISTINCT ON (attempt.payment_id)
                attempt.payment_id, attempt.provider_id, payment.currency, payment.amount_minor
         FROM payments payment
         JOIN payment_attempts attempt ON attempt.payment_id = payment.id
         WHERE payment.event_id = $1 AND attempt.status = 'SUCCEEDED'
         ORDER BY attempt.payment_id,
                  coalesce(attempt.resolved_at, attempt.updated_at) DESC,
                  attempt.id DESC
       )
       SELECT provider_id, currency, count(*)::text AS transaction_count,
              sum(amount_minor)::text AS value_minor
       FROM settled
       GROUP BY provider_id, currency
       ORDER BY provider_id, currency`,
      [eventId],
    );
  }

  private async inventoryRisks(eventId: string): Promise<InventoryRiskRow[]> {
    return this.database.query<InventoryRiskRow>(
      `SELECT alert.id,
              alert.alert_type,
              alert.severity,
              CASE
                WHEN alert.state = 'RESOLVED' THEN 'RESOLVED'
                WHEN alert.state = 'ASSIGNED' OR control.state = 'ASSIGNED' THEN 'ASSIGNED'
                WHEN alert.state = 'ACKNOWLEDGED' OR control.state = 'ACKNOWLEDGED' THEN 'ACKNOWLEDGED'
                ELSE alert.state
              END AS effective_state,
              alert.inventory_location_id,
              inventory_location.name AS inventory_location_name,
              alert.sku_id,
              coalesce(sku.name, alert.sku_id) AS sku_name,
              alert.available_quantity::text,
              alert.minutes_of_cover::text,
              alert.suggested_source_location_id,
              suggested_source.name AS suggested_source_location_name,
              alert.suggested_transfer_quantity::text,
              alert.responsible_actor_id,
              coalesce(control.assigned_actor_id::text, alert.assigned_actor_id) AS effective_assigned_actor_id,
              alert.opened_at
       FROM inventory_alert_projection alert
       LEFT JOIN command_centre_inventory_alert_control control
         ON control.alert_id = alert.id AND control.event_id::text = alert.event_id
       LEFT JOIN inventory_locations inventory_location
         ON inventory_location.id::text = alert.inventory_location_id
       LEFT JOIN inventory_locations suggested_source
         ON suggested_source.id::text = alert.suggested_source_location_id
       LEFT JOIN skus sku ON sku.id::text = alert.sku_id
       WHERE alert.event_id = $1 AND alert.state <> 'RESOLVED'
       ORDER BY CASE alert.severity WHEN 'CRITICAL' THEN 1 WHEN 'URGENT' THEN 2 ELSE 3 END,
                alert.minutes_of_cover ASC NULLS LAST,
                alert.opened_at ASC
       LIMIT 50`,
      [eventId],
    );
  }

  private async activeTransfers(eventId: string): Promise<TransferRow[]> {
    return this.database.query<TransferRow>(
      `SELECT transfer.id,
              transfer.source_location_id,
              source.name AS source_location_name,
              transfer.destination_location_id,
              destination.name AS destination_location_name,
              transfer.state,
              transfer.assigned_actor_id,
              transfer.source_updated_at
       FROM inventory_transfer_projection transfer
       LEFT JOIN inventory_locations source ON source.id::text = transfer.source_location_id
       LEFT JOIN inventory_locations destination ON destination.id::text = transfer.destination_location_id
       WHERE transfer.event_id = $1 AND transfer.state NOT IN ('RECEIVED','CANCELLED','COMPLETED')
       ORDER BY transfer.source_updated_at ASC
       LIMIT 50`,
      [eventId],
    );
  }

  private async devices(eventId: string): Promise<DeviceRow[]> {
    return this.database.query<DeviceRow>(
      `WITH event_devices AS (
         SELECT DISTINCT ON (device_id)
                device_id, sales_location_id, occurred_at
         FROM sync_order_state
         WHERE event_id = $1
         ORDER BY device_id, occurred_at DESC
       )
       SELECT event_device.device_id,
              event_device.sales_location_id,
              location.name AS sales_location_name,
              device.last_seen_at,
              device.last_cloud_delivery_at,
              device.edge_backlog_count,
              CASE WHEN device.last_seen_at IS NULL THEN NULL
                   ELSE greatest(0, extract(epoch FROM (now() - device.last_seen_at)))::integer
              END AS sync_age_seconds
       FROM event_devices event_device
       LEFT JOIN sync_device_state device ON device.device_id = event_device.device_id
       LEFT JOIN sales_locations location
         ON location.id::text = event_device.sales_location_id AND location.event_id::text = $1
       ORDER BY device.last_seen_at ASC NULLS FIRST, event_device.device_id`,
      [eventId],
    );
  }

  private async watermark(eventId: string): Promise<WatermarkRow> {
    const rows = await this.database.query<WatermarkRow>(
      `WITH event_devices AS (
         SELECT DISTINCT device_id FROM sync_order_state WHERE event_id = $1
       ), marks AS (
         SELECT
           (SELECT max(occurred_at) FROM sync_order_state WHERE event_id = $1) AS orders_at,
           (SELECT max(attempt.updated_at)
              FROM payments payment JOIN payment_attempts attempt ON attempt.payment_id = payment.id
             WHERE payment.event_id = $1) AS payments_at,
           (SELECT max(updated_at) FROM inventory_alert_projection WHERE event_id = $1) AS alerts_at,
           (SELECT max(source_updated_at) FROM inventory_transfer_projection WHERE event_id = $1) AS transfers_at,
           (SELECT max(updated_at) FROM command_centre_inventory_alert_control WHERE event_id::text = $1) AS control_at,
           (SELECT max(device.last_seen_at)
              FROM sync_device_state device JOIN event_devices USING (device_id)) AS devices_at,
           (SELECT count(*) FROM sync_order_state WHERE event_id = $1) AS order_count,
           (SELECT count(*)
              FROM payments payment JOIN payment_attempts attempt ON attempt.payment_id = payment.id
             WHERE payment.event_id = $1) AS attempt_count,
           (SELECT count(*) FROM inventory_alert_projection WHERE event_id = $1) AS alert_count,
           (SELECT count(*) FROM inventory_transfer_projection WHERE event_id = $1) AS transfer_count
       )
       SELECT NULLIF(
                greatest(
                  coalesce(orders_at, 'epoch'::timestamptz),
                  coalesce(payments_at, 'epoch'::timestamptz),
                  coalesce(alerts_at, 'epoch'::timestamptz),
                  coalesce(transfers_at, 'epoch'::timestamptz),
                  coalesce(control_at, 'epoch'::timestamptz),
                  coalesce(devices_at, 'epoch'::timestamptz)
                ),
                'epoch'::timestamptz
              ) AS latest_source_at,
              md5(concat_ws('|',
                coalesce(orders_at::text,''), coalesce(payments_at::text,''),
                coalesce(alerts_at::text,''), coalesce(transfers_at::text,''),
                coalesce(control_at::text,''), coalesce(devices_at::text,''),
                order_count::text, attempt_count::text, alert_count::text, transfer_count::text
              )) AS version_token
       FROM marks`,
      [eventId],
    );
    return rows[0] ?? { latest_source_at: null, version_token: 'empty' };
  }

  private async realtimeVersion(eventId: string): Promise<CommandCentreRealtimeEvent> {
    const watermark = await this.watermark(eventId);
    return {
      eventId,
      serverTime: new Date().toISOString(),
      versionToken: watermark.version_token,
    };
  }

  private salesSummary(rows: SalesRow[]): CommandCentreSnapshot['sales'] {
    const transactionCount = rows.reduce((sum, row) => sum + Number(row.transaction_count), 0);
    const grossSales: CommandCentreCurrencyAmount[] = rows.map((row) => ({
      currency: row.currency,
      amountMinor: row.gross_minor,
    }));
    const averageOrderValue: CommandCentreCurrencyAverage[] = rows.map((row) => ({
      currency: row.currency,
      averageOrderValueMinor: row.average_minor,
    }));
    const currentSalesVelocity: CommandCentreCurrencyVelocity[] = rows.map((row) => ({
      currency: row.currency,
      amountMinorPerMinute: row.velocity_minor_per_minute,
    }));
    const lastSaleAt =
      rows
        .map((row) => row.last_sale_at)
        .filter((value): value is Date | string => value !== null)
        .map(iso)
        .sort()
        .at(-1) ?? null;
    return { transactionCount, grossSales, averageOrderValue, currentSalesVelocity, lastSaleAt };
  }

  private locationMetrics(rows: LocationRow[]): CommandCentreLocationMetric[] {
    const grouped = new Map<string, CommandCentreLocationMetric>();
    for (const row of rows) {
      const current = grouped.get(row.sales_location_id) ?? {
        salesLocationId: row.sales_location_id,
        name: row.name,
        transactionCount: 0,
        grossSales: [],
        currentSalesVelocity: [],
        lastSaleAt: null,
      };
      current.transactionCount += Number(row.transaction_count);
      current.grossSales.push({ currency: row.currency, amountMinor: row.gross_minor });
      current.currentSalesVelocity.push({
        currency: row.currency,
        amountMinorPerMinute: row.velocity_minor_per_minute,
      });
      const candidate = isoNullable(row.last_sale_at);
      if (candidate && (!current.lastSaleAt || candidate > current.lastSaleAt)) {
        current.lastSaleAt = candidate;
      }
      grouped.set(row.sales_location_id, current);
    }
    return [...grouped.values()].sort((left, right) =>
      (left.lastSaleAt ?? '').localeCompare(right.lastSaleAt ?? ''),
    );
  }

  private productMetrics(rows: ProductRow[]): CommandCentreProductMetric[] {
    const grouped = new Map<string, CommandCentreProductMetric>();
    for (const row of rows) {
      const current = grouped.get(row.sku_id) ?? {
        skuId: row.sku_id,
        name: row.name,
        quantitySold: '0',
        grossSales: [],
      };
      current.quantitySold = (BigInt(current.quantitySold) + BigInt(row.quantity_sold)).toString();
      current.grossSales.push({ currency: row.currency, amountMinor: row.gross_minor });
      grouped.set(row.sku_id, current);
    }
    return [...grouped.values()]
      .sort((left, right) => {
        const leftQuantity = BigInt(left.quantitySold);
        const rightQuantity = BigInt(right.quantitySold);
        return leftQuantity === rightQuantity
          ? left.skuId.localeCompare(right.skuId)
          : leftQuantity > rightQuantity
            ? -1
            : 1;
      })
      .slice(0, 10);
  }

  private paymentHealth(rows: AttemptHealthRow[]): CommandCentrePaymentAttemptHealth {
    const totals = rows.reduce(
      (accumulator, row) => {
        accumulator.total += Number(row.total_count);
        accumulator.pending += Number(row.pending_count);
        accumulator.unknown += Number(row.unknown_count);
        accumulator.failed += Number(row.failed_count);
        return accumulator;
      },
      { total: 0, pending: 0, unknown: 0, failed: 0 },
    );
    return {
      totalCount: totals.total,
      pendingCount: totals.pending,
      unknownCount: totals.unknown,
      failedCount: totals.failed,
      pendingRate: rate(totals.pending, totals.total),
      unknownRate: rate(totals.unknown, totals.total),
      failureRate: rate(totals.failed, totals.total),
      unknownValue: rows
        .filter((row) => row.unknown_value_minor !== '0')
        .map((row) => ({ currency: row.currency, amountMinor: row.unknown_value_minor })),
    };
  }

  private inventoryRiskViews(rows: InventoryRiskRow[]): CommandCentreInventoryRisk[] {
    return rows.map((row) => ({
      alertId: row.id,
      alertType: row.alert_type,
      severity: row.severity,
      state: row.effective_state,
      inventoryLocationId: row.inventory_location_id,
      inventoryLocationName: row.inventory_location_name,
      skuId: row.sku_id,
      skuName: row.sku_name,
      availableQuantityBase: row.available_quantity,
      minutesOfCover: row.minutes_of_cover,
      suggestedSourceLocationId: row.suggested_source_location_id,
      suggestedSourceLocationName: row.suggested_source_location_name,
      suggestedTransferQuantityBase: row.suggested_transfer_quantity,
      responsibleActorId: row.responsible_actor_id,
      assignedActorId: row.effective_assigned_actor_id,
      openedAt: iso(row.opened_at),
    }));
  }

  private transferViews(rows: TransferRow[]): CommandCentreTransferMetric[] {
    return rows.map((row) => ({
      transferId: row.id,
      sourceLocationId: row.source_location_id,
      sourceLocationName: row.source_location_name,
      destinationLocationId: row.destination_location_id,
      destinationLocationName: row.destination_location_name,
      state: row.state,
      assignedActorId: row.assigned_actor_id,
      updatedAt: iso(row.source_updated_at),
    }));
  }

  private deviceViews(rows: DeviceRow[]): CommandCentreDeviceMetric[] {
    return rows.map((row) => {
      const age = row.sync_age_seconds === null ? null : Number(row.sync_age_seconds);
      const backlog = row.edge_backlog_count ?? 0;
      const status: CommandCentreDeviceMetric['status'] =
        age === null || age > 120 ? 'STALE' : backlog > 0 || age > 30 ? 'DEGRADED' : 'HEALTHY';
      return {
        deviceId: row.device_id,
        salesLocationId: row.sales_location_id,
        salesLocationName: row.sales_location_name,
        lastSeenAt: isoNullable(row.last_seen_at),
        lastCloudDeliveryAt: isoNullable(row.last_cloud_delivery_at),
        edgeBacklogCount: backlog,
        syncAgeSeconds: age,
        status,
      };
    });
  }

  private alerts(
    risks: CommandCentreInventoryRisk[],
    paymentHealth: CommandCentrePaymentAttemptHealth,
    latestAttemptAt: string | null,
    rails: ReturnType<PaymentRailService['availability']>,
    devices: CommandCentreDeviceMetric[],
    generatedAt: string,
  ): CommandCentreAlert[] {
    const alerts: CommandCentreAlert[] = risks.map((risk) => ({
      id: `inventory:${risk.alertId}`,
      source: 'INVENTORY',
      severity: severity(risk.severity),
      state: risk.state,
      title: `${risk.alertType}: ${risk.skuName}`,
      detail: `${risk.inventoryLocationName ?? 'Event-wide'} • ${risk.minutesOfCover ?? 'unknown'} minutes of cover`,
      openedAt: risk.openedAt,
      inventoryAlertId: risk.alertId,
      actionable: risk.state === 'OPEN' || risk.state === 'ACKNOWLEDGED',
      assignedActorId: risk.assignedActorId,
    }));

    if (paymentHealth.unknownCount > 0) {
      alerts.push({
        id: 'payment:unknown',
        source: 'PAYMENT',
        severity: 'CRITICAL',
        state: 'OPEN',
        title: `${paymentHealth.unknownCount} payment attempt(s) need reconciliation`,
        detail: `Unknown payment rate ${(paymentHealth.unknownRate * 100).toFixed(1)}%`,
        openedAt: latestAttemptAt ?? generatedAt,
        inventoryAlertId: null,
        actionable: false,
        assignedActorId: null,
      });
    }
    if (paymentHealth.pendingCount > 0) {
      alerts.push({
        id: 'payment:pending',
        source: 'PAYMENT',
        severity: paymentHealth.pendingRate >= 0.1 ? 'URGENT' : 'WARNING',
        state: 'OPEN',
        title: `${paymentHealth.pendingCount} payment attempt(s) pending`,
        detail: `Pending payment rate ${(paymentHealth.pendingRate * 100).toFixed(1)}%`,
        openedAt: latestAttemptAt ?? generatedAt,
        inventoryAlertId: null,
        actionable: false,
        assignedActorId: null,
      });
    }
    for (const rail of rails) {
      if (rail.status === 'AVAILABLE') continue;
      alerts.push({
        id: `payment-rail:${rail.providerId}`,
        source: 'PAYMENT',
        severity: rail.status === 'DEGRADED' ? 'URGENT' : 'WARNING',
        state: rail.status,
        title: `${rail.providerId} payment rail ${rail.status.toLowerCase()}`,
        detail: rail.detailCode ?? 'Provider availability requires attention',
        openedAt: generatedAt,
        inventoryAlertId: null,
        actionable: false,
        assignedActorId: null,
      });
    }
    for (const device of devices) {
      if (device.status === 'HEALTHY') continue;
      alerts.push({
        id: `device:${device.deviceId}`,
        source: 'DEVICE',
        severity: device.status === 'STALE' ? 'CRITICAL' : 'WARNING',
        state: device.status,
        title: `${device.deviceId} is ${device.status.toLowerCase()}`,
        detail: `${device.salesLocationName ?? 'Unknown location'} • backlog ${device.edgeBacklogCount}`,
        openedAt: device.lastSeenAt ?? generatedAt,
        inventoryAlertId: null,
        actionable: false,
        assignedActorId: null,
      });
    }

    return alerts.sort((left, right) => {
      const severityDifference =
        alertSeverityRank(left.severity) - alertSeverityRank(right.severity);
      return severityDifference !== 0
        ? severityDifference
        : left.openedAt.localeCompare(right.openedAt);
    });
  }
}
