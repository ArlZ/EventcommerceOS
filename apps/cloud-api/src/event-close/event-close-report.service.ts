import { Inject, Injectable } from '@nestjs/common';
import type {
  EventCloseCashScope,
  EventCloseCashSummary,
  EventCloseCriticalAlert,
  EventCloseDrilldown,
  EventCloseFinancialReconciliation,
  EventCloseInventoryVariance,
  EventCloseMoney,
  EventCloseOpenTransfer,
  EventClosePaymentMethodSummary,
  EventCloseProviderReconciliation,
  EventCloseReport,
  EventCloseState,
  EventCloseUnresolvedPayment,
} from '@event-commerce/contracts';
import type { PoolClient, QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';

export interface EventCloseEventMeta {
  id: string;
  organisationId: string;
  name: string;
  timezone: string;
  lifecycle: string;
}

interface RowSource {
  rows<T extends QueryResultRow>(sql: string, values?: readonly unknown[]): Promise<T[]>;
}

interface CurrencyAmountRow extends QueryResultRow {
  currency: string;
  amount_minor: string;
}

interface GrossSalesRow extends CurrencyAmountRow {
  transaction_count: string;
}

interface AdjustmentRow extends CurrencyAmountRow {
  kind: 'DISCOUNT' | 'COMP' | 'VOID' | 'CASH_REFUND';
}

interface PaymentMethodRow extends QueryResultRow {
  provider_id: string;
  currency: string;
  succeeded_count: string;
  gross_minor: string;
  refund_minor: string;
  reversal_minor: string;
  unresolved_count: string;
}

interface ProviderRow extends QueryResultRow {
  provider_id: string;
  currency: string;
  succeeded_count: string;
  succeeded_value_minor: string;
  pending_count: string;
  unknown_count: string;
  failed_count: string;
  unknown_value_minor: string;
  adjustment_unresolved_count: string;
}

interface CashExpectedRow extends QueryResultRow {
  sales_location_id: string;
  sales_location_name: string | null;
  device_id: string;
  cashier_id: string;
  currency: string;
  expected_minor: string;
}

interface CashDeclarationRow extends QueryResultRow {
  id: string;
  sales_location_id: string;
  device_id: string | null;
  cashier_id: string | null;
  currency: string;
  declared_minor: string;
  declared_at: Date | string;
}

interface InventoryVarianceRow extends QueryResultRow {
  inventory_location_id: string;
  inventory_location_name: string | null;
  sku_id: string;
  sku_name: string;
  expected_quantity: string;
  physical_quantity: string;
  variance_quantity: string;
  unit_cost_minor: string | null;
  valuation_currency: string | null;
  variance_value_minor: string | null;
  count_id: string;
  count_closed_at: string | null;
}

interface UnresolvedPaymentRow extends QueryResultRow {
  payment_attempt_id: string;
  payment_id: string;
  order_id: string;
  provider_id: string;
  amount_minor: string;
  currency: string;
  status: 'CREATED' | 'INITIATED' | 'PENDING' | 'UNKNOWN';
  provider_reference: string | null;
  failure_code: string | null;
  reconciliation_status: string | null;
  reconciliation_error_code: string | null;
  updated_at: Date | string;
}

interface TransferRow extends QueryResultRow {
  id: string;
  source_location_id: string;
  destination_location_id: string;
  state: string;
  assigned_actor_id: string | null;
  lines: unknown[];
  source_updated_at: Date | string;
}

interface CriticalAlertRow extends QueryResultRow {
  id: string;
  alert_type: string;
  effective_state: string;
  inventory_location_id: string | null;
  sku_id: string;
  available_quantity: string;
  minutes_of_cover: string | null;
  assigned_actor_id: string | null;
  opened_at: Date | string;
}

interface DrilldownRow extends QueryResultRow {
  dimension_type: 'SALES_LOCATION' | 'DEVICE' | 'CASHIER';
  dimension_id: string;
  dimension_name: string | null;
  currency: string;
  transaction_count: string;
  gross_minor: string;
  discount_minor: string;
  comp_minor: string;
  void_minor: string;
  refund_minor: string;
  net_minor: string;
}

interface CloseStateRow extends QueryResultRow {
  last_action: 'OPERATIONALLY_CLOSE' | 'REOPEN' | null;
  last_action_at: Date | string | null;
  last_closed_at: Date | string | null;
  last_closed_revision: number | null;
  last_closed_report_id: string | null;
  last_closed_source_version: string | null;
}

interface VersionRow extends QueryResultRow {
  version_token: string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function big(value: string | number | bigint | null | undefined): bigint {
  if (value === null || value === undefined) return 0n;
  return BigInt(value);
}

function add(map: Map<string, bigint>, currency: string, amount: string | bigint): void {
  map.set(currency, (map.get(currency) ?? 0n) + big(amount));
}

function money(map: Map<string, bigint>): EventCloseMoney[] {
  return [...map.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, amountMinor]) => ({ currency, amountMinor: amountMinor.toString() }));
}

function mapFrom(rows: CurrencyAmountRow[]): Map<string, bigint> {
  const result = new Map<string, bigint>();
  rows.forEach((row) => add(result, row.currency, row.amount_minor));
  return result;
}

function stateFromAction(action: CloseStateRow['last_action']): EventCloseState {
  if (action === 'OPERATIONALLY_CLOSE') return 'OPERATIONALLY_CLOSED';
  if (action === 'REOPEN') return 'REOPENED';
  return 'OPEN';
}

function cashKey(input: {
  salesLocationId: string;
  deviceId: string | null;
  cashierId: string | null;
  currency: string;
}): string {
  return [
    input.salesLocationId,
    input.deviceId ?? 'unassigned-device',
    input.cashierId ?? 'unassigned-cashier',
    input.currency,
  ].join('|');
}

@Injectable()
export class EventCloseReportService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async buildLive(event: EventCloseEventMeta): Promise<EventCloseReport> {
    return this.build(this.databaseSource(), event, new Date().toISOString());
  }

  async buildInTransaction(
    client: PoolClient,
    event: EventCloseEventMeta,
    generatedAt: string,
  ): Promise<EventCloseReport> {
    return this.build(this.clientSource(client), event, generatedAt);
  }

  async sourceVersionInTransaction(client: PoolClient, eventId: string): Promise<string> {
    return this.sourceVersion(this.clientSource(client), eventId);
  }

  private async build(
    source: RowSource,
    event: EventCloseEventMeta,
    generatedAt: string,
  ): Promise<EventCloseReport> {
    const eventId = event.id;
    const grossRows = await source.rows<GrossSalesRow>(
      `SELECT currency, count(*)::text AS transaction_count,
              coalesce(sum(total_minor),0)::text AS amount_minor
       FROM sync_order_state
       WHERE event_id=$1 AND state='CLOSED'
       GROUP BY currency ORDER BY currency`,
      [eventId],
    );
    const adjustmentRows = await source.rows<AdjustmentRow>(
      `SELECT kind,currency,sum(amount_minor)::text AS amount_minor
       FROM commerce_order_adjustments
       WHERE event_id::text=$1
       GROUP BY kind,currency ORDER BY kind,currency`,
      [eventId],
    );
    const refundRows = await source.rows<CurrencyAmountRow>(
      `SELECT payment.currency,sum(refund.amount_minor)::text AS amount_minor
       FROM payment_refunds refund
       JOIN payments payment ON payment.id=refund.payment_id
       WHERE payment.event_id=$1 AND refund.status='SUCCEEDED'
       GROUP BY payment.currency ORDER BY payment.currency`,
      [eventId],
    );
    const paymentMethodRows = await source.rows<PaymentMethodRow>(
      `WITH settled AS (
         SELECT DISTINCT ON (attempt.payment_id)
                attempt.payment_id,attempt.provider_id,payment.currency,payment.amount_minor
         FROM payments payment
         JOIN payment_attempts attempt ON attempt.payment_id=payment.id
         WHERE payment.event_id=$1 AND attempt.status='SUCCEEDED'
         ORDER BY attempt.payment_id,
                  coalesce(attempt.resolved_at,attempt.updated_at) DESC,
                  attempt.id DESC
       ), refunds AS (
         SELECT payment_id,sum(amount_minor) AS amount_minor
         FROM payment_refunds WHERE status='SUCCEEDED' GROUP BY payment_id
       ), reversals AS (
         SELECT payment_id,sum(amount_minor) AS amount_minor
         FROM payment_reversals WHERE status='SUCCEEDED' GROUP BY payment_id
       ), settled_summary AS (
         SELECT settled.provider_id,settled.currency,
                count(*) AS succeeded_count,
                sum(settled.amount_minor) AS gross_minor,
                coalesce(sum(refunds.amount_minor),0) AS refund_minor,
                coalesce(sum(reversals.amount_minor),0) AS reversal_minor
         FROM settled
         LEFT JOIN refunds USING(payment_id)
         LEFT JOIN reversals USING(payment_id)
         GROUP BY settled.provider_id,settled.currency
       ), unresolved_summary AS (
         SELECT attempt.provider_id,payment.currency,count(*) AS unresolved_count
         FROM payment_attempts attempt
         JOIN payments payment ON payment.id=attempt.payment_id
         WHERE payment.event_id=$1
           AND attempt.status IN ('CREATED','INITIATED','PENDING','UNKNOWN')
         GROUP BY attempt.provider_id,payment.currency
       ), keys AS (
         SELECT provider_id,currency FROM settled_summary
         UNION SELECT provider_id,currency FROM unresolved_summary
       )
       SELECT keys.provider_id,keys.currency,
              coalesce(settled_summary.succeeded_count,0)::text AS succeeded_count,
              coalesce(settled_summary.gross_minor,0)::text AS gross_minor,
              coalesce(settled_summary.refund_minor,0)::text AS refund_minor,
              coalesce(settled_summary.reversal_minor,0)::text AS reversal_minor,
              coalesce(unresolved_summary.unresolved_count,0)::text AS unresolved_count
       FROM keys
       LEFT JOIN settled_summary USING(provider_id,currency)
       LEFT JOIN unresolved_summary USING(provider_id,currency)
       ORDER BY keys.provider_id,keys.currency`,
      [eventId],
    );
    const providerRows = await source.rows<ProviderRow>(
      `WITH settled AS (
         SELECT DISTINCT ON (attempt.payment_id)
                attempt.payment_id,attempt.provider_id,payment.currency,payment.amount_minor
         FROM payments payment
         JOIN payment_attempts attempt ON attempt.payment_id=payment.id
         WHERE payment.event_id=$1 AND attempt.status='SUCCEEDED'
         ORDER BY attempt.payment_id,
                  coalesce(attempt.resolved_at,attempt.updated_at) DESC,
                  attempt.id DESC
       ), settled_summary AS (
         SELECT provider_id,currency,count(*) AS succeeded_count,
                sum(amount_minor) AS succeeded_value_minor
         FROM settled GROUP BY provider_id,currency
       ), attempt_summary AS (
         SELECT attempt.provider_id,payment.currency,
                count(*) FILTER (WHERE attempt.status IN ('CREATED','INITIATED','PENDING')) AS pending_count,
                count(*) FILTER (WHERE attempt.status='UNKNOWN') AS unknown_count,
                count(*) FILTER (WHERE attempt.status='FAILED') AS failed_count
         FROM payment_attempts attempt
         JOIN payments payment ON payment.id=attempt.payment_id
         WHERE payment.event_id=$1
         GROUP BY attempt.provider_id,payment.currency
       ), unknown_value AS (
         SELECT provider_id,currency,sum(amount_minor) AS unknown_value_minor
         FROM (
           SELECT DISTINCT attempt.provider_id,payment.currency,payment.id,payment.amount_minor
           FROM payment_attempts attempt
           JOIN payments payment ON payment.id=attempt.payment_id
           WHERE payment.event_id=$1 AND attempt.status='UNKNOWN'
         ) uncertain
         GROUP BY provider_id,currency
       ), adjustment_unresolved AS (
         SELECT provider_id,currency,count(*) AS adjustment_unresolved_count
         FROM (
           SELECT refund.provider_id,refund.currency
           FROM payment_refunds refund JOIN payments payment ON payment.id=refund.payment_id
           WHERE payment.event_id=$1 AND refund.status IN ('REQUESTED','PENDING','UNKNOWN')
           UNION ALL
           SELECT reversal.provider_id,reversal.currency
           FROM payment_reversals reversal JOIN payments payment ON payment.id=reversal.payment_id
           WHERE payment.event_id=$1 AND reversal.status IN ('REQUESTED','PENDING','UNKNOWN')
         ) adjustments
         GROUP BY provider_id,currency
       ), keys AS (
         SELECT provider_id,currency FROM settled_summary
         UNION SELECT provider_id,currency FROM attempt_summary
         UNION SELECT provider_id,currency FROM adjustment_unresolved
       )
       SELECT keys.provider_id,keys.currency,
              coalesce(settled_summary.succeeded_count,0)::text AS succeeded_count,
              coalesce(settled_summary.succeeded_value_minor,0)::text AS succeeded_value_minor,
              coalesce(attempt_summary.pending_count,0)::text AS pending_count,
              coalesce(attempt_summary.unknown_count,0)::text AS unknown_count,
              coalesce(attempt_summary.failed_count,0)::text AS failed_count,
              coalesce(unknown_value.unknown_value_minor,0)::text AS unknown_value_minor,
              coalesce(adjustment_unresolved.adjustment_unresolved_count,0)::text AS adjustment_unresolved_count
       FROM keys
       LEFT JOIN settled_summary USING(provider_id,currency)
       LEFT JOIN attempt_summary USING(provider_id,currency)
       LEFT JOIN unknown_value USING(provider_id,currency)
       LEFT JOIN adjustment_unresolved USING(provider_id,currency)
       ORDER BY keys.provider_id,keys.currency`,
      [eventId],
    );
    const cashExpectedRows = await source.rows<CashExpectedRow>(
      `WITH adjustment_by_order AS (
         SELECT order_id,
                sum(amount_minor) FILTER (WHERE kind IN ('DISCOUNT','COMP','VOID','CASH_REFUND')) AS reductions
         FROM commerce_order_adjustments
         WHERE event_id::text=$1
         GROUP BY order_id
       )
       SELECT coalesce(state.sales_location_id,'unassigned-location') AS sales_location_id,
              location.name AS sales_location_name,
              state.device_id,
              coalesce(state.cashier_id,'unassigned-cashier') AS cashier_id,
              state.currency,
              sum(state.total_minor-coalesce(adjustment_by_order.reductions,0))::text AS expected_minor
       FROM sync_order_state state
       LEFT JOIN adjustment_by_order ON adjustment_by_order.order_id=state.order_id
       LEFT JOIN sales_locations location
         ON location.id::text=state.sales_location_id AND location.event_id::text=$1
       WHERE state.event_id=$1 AND state.state='CLOSED' AND state.close_method='CASH'
       GROUP BY state.sales_location_id,location.name,state.device_id,state.cashier_id,state.currency
       ORDER BY state.sales_location_id,state.device_id,state.cashier_id,state.currency`,
      [eventId],
    );
    const cashDeclarationRows = await source.rows<CashDeclarationRow>(
      `SELECT DISTINCT ON (sales_location_id,coalesce(device_id,''),coalesce(cashier_id,''),currency)
              id,sales_location_id::text,device_id,cashier_id,currency,
              declared_minor::text,declared_at
       FROM event_cash_declarations
       WHERE event_id::text=$1
       ORDER BY sales_location_id,coalesce(device_id,''),coalesce(cashier_id,''),currency,
                declared_at DESC,id DESC`,
      [eventId],
    );
    const inventoryRows = await source.rows<InventoryVarianceRow>(
      `WITH count_lines AS (
         SELECT count.id AS count_id,count.inventory_location_id,count.updated_at,
                count.payload->>'closedAt' AS count_closed_at,line
         FROM inventory_count_projection count
         CROSS JOIN LATERAL jsonb_array_elements(
           CASE WHEN jsonb_typeof(count.payload->'lines')='array'
                THEN count.payload->'lines' ELSE '[]'::jsonb END
         ) line
         WHERE count.event_id=$1 AND count.state='CLOSED'
           AND coalesce(line->>'skuId','')<>''
           AND coalesce(line->>'countedQuantityBase','') ~ '^-?[0-9]+$'
           AND coalesce(line->>'expectedQuantityBase','') ~ '^-?[0-9]+$'
       ), latest AS (
         SELECT DISTINCT ON (inventory_location_id,line->>'skuId')
                count_id,inventory_location_id,updated_at,count_closed_at,line
         FROM count_lines
         ORDER BY inventory_location_id,line->>'skuId',updated_at DESC,count_id DESC
       ), costs AS (
         SELECT DISTINCT ON (sku_id) sku_id::text AS sku_id,currency,unit_cost_minor
         FROM event_inventory_unit_cost_declarations
         WHERE event_id::text=$1
         ORDER BY sku_id,declared_at DESC,id DESC
       )
       SELECT latest.inventory_location_id,
              location.name AS inventory_location_name,
              latest.line->>'skuId' AS sku_id,
              coalesce(sku.name,latest.line->>'skuId') AS sku_name,
              latest.line->>'expectedQuantityBase' AS expected_quantity,
              latest.line->>'countedQuantityBase' AS physical_quantity,
              ((latest.line->>'countedQuantityBase')::numeric-
               (latest.line->>'expectedQuantityBase')::numeric)::text AS variance_quantity,
              costs.unit_cost_minor::text,
              costs.currency AS valuation_currency,
              CASE WHEN costs.unit_cost_minor IS NULL THEN NULL
                   ELSE (((latest.line->>'countedQuantityBase')::numeric-
                          (latest.line->>'expectedQuantityBase')::numeric) *
                         costs.unit_cost_minor::numeric)::text
              END AS variance_value_minor,
              latest.count_id,latest.count_closed_at
       FROM latest
       LEFT JOIN inventory_locations location ON location.id::text=latest.inventory_location_id
       LEFT JOIN skus sku ON sku.id::text=latest.line->>'skuId'
       LEFT JOIN costs ON costs.sku_id=latest.line->>'skuId'
       ORDER BY latest.inventory_location_id,latest.line->>'skuId'`,
      [eventId],
    );
    const unresolvedRows = await source.rows<UnresolvedPaymentRow>(
      `SELECT attempt.id AS payment_attempt_id,payment.id AS payment_id,payment.order_id,
              attempt.provider_id,payment.amount_minor::text,payment.currency,attempt.status,
              attempt.provider_reference,attempt.failure_code,
              job.status AS reconciliation_status,job.last_error_code AS reconciliation_error_code,
              attempt.updated_at
       FROM payment_attempts attempt
       JOIN payments payment ON payment.id=attempt.payment_id
       LEFT JOIN payment_reconciliation_jobs job ON job.payment_attempt_id=attempt.id
       WHERE payment.event_id=$1
         AND attempt.status IN ('CREATED','INITIATED','PENDING','UNKNOWN')
       ORDER BY CASE attempt.status WHEN 'UNKNOWN' THEN 1 ELSE 2 END,attempt.updated_at`,
      [eventId],
    );
    const transferRows = await source.rows<TransferRow>(
      `SELECT id,source_location_id,destination_location_id,state,assigned_actor_id,lines,
              source_updated_at
       FROM inventory_transfer_projection
       WHERE event_id=$1 AND state NOT IN ('RECEIVED','CANCELLED','COMPLETED')
       ORDER BY source_updated_at,id`,
      [eventId],
    );
    const criticalAlertRows = await source.rows<CriticalAlertRow>(
      `SELECT alert.id,alert.alert_type,
              CASE
                WHEN alert.state='RESOLVED' THEN 'RESOLVED'
                WHEN alert.state='ASSIGNED' OR control.state='ASSIGNED' THEN 'ASSIGNED'
                WHEN alert.state='ACKNOWLEDGED' OR control.state='ACKNOWLEDGED' THEN 'ACKNOWLEDGED'
                ELSE alert.state
              END AS effective_state,
              alert.inventory_location_id,alert.sku_id,alert.available_quantity::text,
              alert.minutes_of_cover::text,
              coalesce(control.assigned_actor_id::text,alert.assigned_actor_id) AS assigned_actor_id,
              alert.opened_at
       FROM inventory_alert_projection alert
       LEFT JOIN command_centre_inventory_alert_control control
         ON control.alert_id=alert.id AND control.event_id::text=alert.event_id
       WHERE alert.event_id=$1 AND alert.severity='CRITICAL' AND alert.state<>'RESOLVED'
       ORDER BY alert.opened_at,alert.id`,
      [eventId],
    );
    const drilldownRows = await source.rows<DrilldownRow>(
      `WITH adjustments AS (
         SELECT order_id,
                sum(amount_minor) FILTER (WHERE kind='DISCOUNT') AS discount_minor,
                sum(amount_minor) FILTER (WHERE kind='COMP') AS comp_minor,
                sum(amount_minor) FILTER (WHERE kind='VOID') AS void_minor,
                sum(amount_minor) FILTER (WHERE kind='CASH_REFUND') AS cash_refund_minor
         FROM commerce_order_adjustments
         WHERE event_id::text=$1 GROUP BY order_id
       ), electronic_refunds AS (
         SELECT payment.order_id,sum(refund.amount_minor) AS refund_minor
         FROM payment_refunds refund
         JOIN payments payment ON payment.id=refund.payment_id
         WHERE payment.event_id=$1 AND refund.status='SUCCEEDED'
         GROUP BY payment.order_id
       ), per_order AS (
         SELECT state.order_id,state.sales_location_id,state.device_id,state.cashier_id,state.currency,
                state.total_minor,
                coalesce(adjustments.discount_minor,0) AS discount_minor,
                coalesce(adjustments.comp_minor,0) AS comp_minor,
                coalesce(adjustments.void_minor,0) AS void_minor,
                coalesce(adjustments.cash_refund_minor,0)+coalesce(electronic_refunds.refund_minor,0) AS refund_minor
         FROM sync_order_state state
         LEFT JOIN adjustments ON adjustments.order_id=state.order_id
         LEFT JOIN electronic_refunds ON electronic_refunds.order_id=state.order_id
         WHERE state.event_id=$1 AND state.state='CLOSED'
       ), location_rows AS (
         SELECT 'SALES_LOCATION'::text AS dimension_type,
                coalesce(per_order.sales_location_id,'unassigned-location') AS dimension_id,
                location.name AS dimension_name,per_order.currency,
                count(*) AS transaction_count,sum(per_order.total_minor) AS gross_minor,
                sum(per_order.discount_minor) AS discount_minor,
                sum(per_order.comp_minor) AS comp_minor,
                sum(per_order.void_minor) AS void_minor,
                sum(per_order.refund_minor) AS refund_minor
         FROM per_order
         LEFT JOIN sales_locations location ON location.id::text=per_order.sales_location_id
         GROUP BY per_order.sales_location_id,location.name,per_order.currency
       ), device_rows AS (
         SELECT 'DEVICE'::text AS dimension_type,per_order.device_id AS dimension_id,
                NULL::text AS dimension_name,per_order.currency,
                count(*) AS transaction_count,sum(per_order.total_minor) AS gross_minor,
                sum(per_order.discount_minor) AS discount_minor,
                sum(per_order.comp_minor) AS comp_minor,
                sum(per_order.void_minor) AS void_minor,
                sum(per_order.refund_minor) AS refund_minor
         FROM per_order GROUP BY per_order.device_id,per_order.currency
       ), cashier_rows AS (
         SELECT 'CASHIER'::text AS dimension_type,
                coalesce(per_order.cashier_id,'unassigned-cashier') AS dimension_id,
                NULL::text AS dimension_name,per_order.currency,
                count(*) AS transaction_count,sum(per_order.total_minor) AS gross_minor,
                sum(per_order.discount_minor) AS discount_minor,
                sum(per_order.comp_minor) AS comp_minor,
                sum(per_order.void_minor) AS void_minor,
                sum(per_order.refund_minor) AS refund_minor
         FROM per_order GROUP BY per_order.cashier_id,per_order.currency
       )
       SELECT dimension_type,dimension_id,dimension_name,currency,
              transaction_count::text,gross_minor::text,discount_minor::text,comp_minor::text,
              void_minor::text,refund_minor::text,
              (gross_minor-discount_minor-comp_minor-void_minor-refund_minor)::text AS net_minor
       FROM (
         SELECT * FROM location_rows
         UNION ALL SELECT * FROM device_rows
         UNION ALL SELECT * FROM cashier_rows
       ) combined
       ORDER BY dimension_type,dimension_id,currency`,
      [eventId],
    );
    const closeRows = await source.rows<CloseStateRow>(
      `WITH last_action AS (
         SELECT action,created_at FROM event_close_actions
         WHERE event_id::text=$1 ORDER BY created_at DESC,id DESC LIMIT 1
       ), last_close AS (
         SELECT action.created_at,action.close_revision,action.report_id,report.source_version_token
         FROM event_close_actions action
         JOIN event_close_reports report ON report.id=action.report_id
         WHERE action.event_id::text=$1 AND action.action='OPERATIONALLY_CLOSE'
         ORDER BY action.created_at DESC,action.id DESC LIMIT 1
       )
       SELECT (SELECT action FROM last_action) AS last_action,
              (SELECT created_at FROM last_action) AS last_action_at,
              (SELECT created_at FROM last_close) AS last_closed_at,
              (SELECT close_revision FROM last_close) AS last_closed_revision,
              (SELECT report_id::text FROM last_close) AS last_closed_report_id,
              (SELECT source_version_token FROM last_close) AS last_closed_source_version`,
      [eventId],
    );
    const sourceVersionToken = await this.sourceVersion(source, eventId);

    const gross = new Map<string, bigint>();
    grossRows.forEach((row) => add(gross, row.currency, row.amount_minor));
    const byKind = new Map<string, Map<string, bigint>>();
    for (const row of adjustmentRows) {
      const kindMap = byKind.get(row.kind) ?? new Map<string, bigint>();
      add(kindMap, row.currency, row.amount_minor);
      byKind.set(row.kind, kindMap);
    }
    const discounts = byKind.get('DISCOUNT') ?? new Map<string, bigint>();
    const comps = byKind.get('COMP') ?? new Map<string, bigint>();
    const voids = byKind.get('VOID') ?? new Map<string, bigint>();
    const cashRefunds = byKind.get('CASH_REFUND') ?? new Map<string, bigint>();
    const electronicRefunds = mapFrom(refundRows);
    const refunds = new Map<string, bigint>(cashRefunds);
    electronicRefunds.forEach((value, currency) => add(refunds, currency, value));

    const currencies = new Set([
      ...gross.keys(),
      ...discounts.keys(),
      ...comps.keys(),
      ...voids.keys(),
      ...refunds.keys(),
    ]);
    const netSales = new Map<string, bigint>();
    currencies.forEach((currency) => {
      netSales.set(
        currency,
        (gross.get(currency) ?? 0n) -
          (discounts.get(currency) ?? 0n) -
          (comps.get(currency) ?? 0n) -
          (voids.get(currency) ?? 0n) -
          (refunds.get(currency) ?? 0n),
      );
    });

    const cashScopes = this.cashScopes(cashExpectedRows, cashDeclarationRows);
    const cashSummary = this.cashSummary(cashScopes);
    const paymentMethods = this.paymentMethods(paymentMethodRows, cashSummary);
    const unresolvedPayments: EventCloseUnresolvedPayment[] = unresolvedRows.map((row) => ({
      paymentAttemptId: row.payment_attempt_id,
      paymentId: row.payment_id,
      orderId: row.order_id,
      providerId: row.provider_id,
      amountMinor: row.amount_minor,
      currency: row.currency,
      status: row.status,
      providerReference: row.provider_reference,
      failureCode: row.failure_code,
      reconciliationStatus: row.reconciliation_status,
      reconciliationErrorCode: row.reconciliation_error_code,
      updatedAt: iso(row.updated_at),
    }));
    const providerReconciliation: EventCloseProviderReconciliation[] = providerRows.map((row) => {
      const unresolved =
        Number(row.pending_count) + Number(row.unknown_count) + Number(row.adjustment_unresolved_count);
      return {
        providerId: row.provider_id,
        currency: row.currency,
        succeededCount: Number(row.succeeded_count),
        succeededValueMinor: row.succeeded_value_minor,
        pendingCount: Number(row.pending_count),
        unknownCount: Number(row.unknown_count),
        failedCount: Number(row.failed_count),
        unknownValueMinor: row.unknown_value_minor,
        adjustmentUnknownCount: Number(row.adjustment_unresolved_count),
        transactionReconciliationStatus: unresolved === 0 ? 'RECONCILED' : 'UNRESOLVED',
        settlementStatus: 'PROVIDER_SETTLEMENT_DATA_UNAVAILABLE',
      };
    });
    const inventoryVariances: EventCloseInventoryVariance[] = inventoryRows.map((row) => ({
      inventoryLocationId: row.inventory_location_id,
      inventoryLocationName: row.inventory_location_name,
      skuId: row.sku_id,
      skuName: row.sku_name,
      expectedQuantityBase: row.expected_quantity,
      physicalQuantityBase: row.physical_quantity,
      varianceQuantityBase: row.variance_quantity,
      unitCostMinor: row.unit_cost_minor,
      valuationCurrency: row.valuation_currency,
      varianceValueMinor: row.variance_value_minor,
      valuationStatus: row.unit_cost_minor === null ? 'MISSING_UNIT_COST' : 'VALUED',
      countId: row.count_id,
      countClosedAt: row.count_closed_at,
    }));
    const openTransfers: EventCloseOpenTransfer[] = transferRows.map((row) => ({
      transferId: row.id,
      sourceLocationId: row.source_location_id,
      destinationLocationId: row.destination_location_id,
      state: row.state,
      assignedActorId: row.assigned_actor_id,
      lines: Array.isArray(row.lines) ? row.lines : [],
      updatedAt: iso(row.source_updated_at),
    }));
    const unresolvedCriticalAlerts: EventCloseCriticalAlert[] = criticalAlertRows
      .filter((row) => row.effective_state !== 'RESOLVED')
      .map((row) => ({
        alertId: row.id,
        alertType: row.alert_type,
        state: row.effective_state,
        inventoryLocationId: row.inventory_location_id,
        skuId: row.sku_id,
        availableQuantityBase: row.available_quantity,
        minutesOfCover: row.minutes_of_cover,
        assignedActorId: row.assigned_actor_id,
        openedAt: iso(row.opened_at),
      }));
    const drilldowns: EventCloseDrilldown[] = drilldownRows.map((row) => ({
      dimensionType: row.dimension_type,
      dimensionId: row.dimension_id,
      dimensionName: row.dimension_name,
      currency: row.currency,
      transactionCount: Number(row.transaction_count),
      grossSalesMinor: row.gross_minor,
      discountMinor: row.discount_minor,
      compMinor: row.comp_minor,
      voidMinor: row.void_minor,
      refundMinor: row.refund_minor,
      netSalesMinor: row.net_minor,
    }));
    const financialReconciliation = this.financialReconciliation(
      netSales,
      paymentMethods,
      cashSummary,
      unresolvedPayments,
    );

    const close = closeRows[0] ?? {
      last_action: null,
      last_action_at: null,
      last_closed_at: null,
      last_closed_revision: null,
      last_closed_report_id: null,
      last_closed_source_version: null,
    };

    return {
      event: {
        eventId: event.id,
        organisationId: event.organisationId,
        name: event.name,
        timezone: event.timezone,
        lifecycle: event.lifecycle,
      },
      close: {
        state: stateFromAction(close.last_action),
        lastActionAt: close.last_action_at === null ? null : iso(close.last_action_at),
        lastClosedAt: close.last_closed_at === null ? null : iso(close.last_closed_at),
        lastClosedRevision: close.last_closed_revision,
        lastClosedReportId: close.last_closed_report_id,
        sourceVersionAtLastClose: close.last_closed_source_version,
        sourceChangedSinceLastClose:
          close.last_closed_source_version !== null &&
          close.last_closed_source_version !== sourceVersionToken,
      },
      generatedAt,
      sourceVersionToken,
      sales: {
        grossSales: money(gross),
        discounts: money(discounts),
        comps: money(comps),
        voids: money(voids),
        refunds: money(refunds),
        netSales: money(netSales),
      },
      paymentMethods,
      providerReconciliation,
      cash: { summary: cashSummary, scopes: cashScopes },
      inventoryVariances,
      unresolvedPayments,
      openTransfers,
      unresolvedCriticalAlerts,
      drilldowns,
      financialReconciliation,
    };
  }

  private cashScopes(
    expectedRows: CashExpectedRow[],
    declarationRows: CashDeclarationRow[],
  ): EventCloseCashScope[] {
    const scopes = new Map<string, EventCloseCashScope>();
    for (const row of expectedRows) {
      const key = cashKey({
        salesLocationId: row.sales_location_id,
        deviceId: row.device_id,
        cashierId: row.cashier_id,
        currency: row.currency,
      });
      scopes.set(key, {
        salesLocationId: row.sales_location_id,
        salesLocationName: row.sales_location_name,
        deviceId: row.device_id,
        cashierId: row.cashier_id,
        currency: row.currency,
        expectedMinor: row.expected_minor,
        declaredMinor: null,
        varianceMinor: null,
        declarationStatus: 'MISSING',
        declarationId: null,
        declaredAt: null,
      });
    }
    for (const row of declarationRows) {
      const deviceId = row.device_id ?? 'unassigned-device';
      const cashierId = row.cashier_id ?? 'unassigned-cashier';
      const key = cashKey({
        salesLocationId: row.sales_location_id,
        deviceId,
        cashierId,
        currency: row.currency,
      });
      const current = scopes.get(key) ?? {
        salesLocationId: row.sales_location_id,
        salesLocationName: null,
        deviceId,
        cashierId,
        currency: row.currency,
        expectedMinor: '0',
        declaredMinor: null,
        varianceMinor: null,
        declarationStatus: 'MISSING' as const,
        declarationId: null,
        declaredAt: null,
      };
      const variance = big(row.declared_minor) - big(current.expectedMinor);
      scopes.set(key, {
        ...current,
        declaredMinor: row.declared_minor,
        varianceMinor: variance.toString(),
        declarationStatus: 'DECLARED',
        declarationId: row.id,
        declaredAt: iso(row.declared_at),
      });
    }
    return [...scopes.values()].sort((left, right) =>
      cashKey(left).localeCompare(cashKey(right)),
    );
  }

  private cashSummary(scopes: EventCloseCashScope[]): EventCloseCashSummary[] {
    const currencies = [...new Set(scopes.map((scope) => scope.currency))].sort();
    return currencies.map((currency) => {
      const currencyScopes = scopes.filter((scope) => scope.currency === currency);
      const expected = currencyScopes.reduce((sum, scope) => sum + big(scope.expectedMinor), 0n);
      const declaredScopes = currencyScopes.filter((scope) => scope.declarationStatus === 'DECLARED');
      const declared = declaredScopes.reduce(
        (sum, scope) => sum + big(scope.declaredMinor),
        0n,
      );
      const status: EventCloseCashSummary['declarationStatus'] =
        declaredScopes.length === 0
          ? 'MISSING'
          : declaredScopes.length === currencyScopes.length
            ? 'COMPLETE'
            : 'PARTIAL';
      return {
        currency,
        expectedMinor: expected.toString(),
        declaredMinor: declaredScopes.length === 0 ? null : declared.toString(),
        varianceMinor: status === 'COMPLETE' ? (declared - expected).toString() : null,
        declarationStatus: status,
      };
    });
  }

  private paymentMethods(
    rows: PaymentMethodRow[],
    cashSummary: EventCloseCashSummary[],
  ): EventClosePaymentMethodSummary[] {
    const electronic = rows.map((row) => ({
      methodId: row.provider_id,
      currency: row.currency,
      succeededCount: Number(row.succeeded_count),
      grossTenderMinor: row.gross_minor,
      refundMinor: row.refund_minor,
      reversalMinor: row.reversal_minor,
      netTenderMinor: (
        big(row.gross_minor) - big(row.refund_minor) - big(row.reversal_minor)
      ).toString(),
      unresolvedAttemptCount: Number(row.unresolved_count),
    }));
    const cash = cashSummary
      .filter((row) => big(row.expectedMinor) !== 0n || row.declaredMinor !== null)
      .map((row) => ({
        methodId: 'cash',
        currency: row.currency,
        succeededCount: 0,
        grossTenderMinor: row.expectedMinor,
        refundMinor: '0',
        reversalMinor: '0',
        netTenderMinor: row.expectedMinor,
        unresolvedAttemptCount: 0,
      }));
    return [...electronic, ...cash].sort((left, right) =>
      `${left.methodId}|${left.currency}`.localeCompare(`${right.methodId}|${right.currency}`),
    );
  }

  private financialReconciliation(
    netSales: Map<string, bigint>,
    paymentMethods: EventClosePaymentMethodSummary[],
    cashSummary: EventCloseCashSummary[],
    unresolvedPayments: EventCloseUnresolvedPayment[],
  ): EventCloseFinancialReconciliation[] {
    const currencies = new Set<string>([
      ...netSales.keys(),
      ...paymentMethods.map((row) => row.currency),
      ...cashSummary.map((row) => row.currency),
    ]);
    return [...currencies]
      .sort()
      .map((currency) => {
        const electronic = paymentMethods
          .filter((row) => row.currency === currency && row.methodId !== 'cash')
          .reduce((sum, row) => sum + big(row.netTenderMinor), 0n);
        const cash = cashSummary.find((row) => row.currency === currency);
        const cashExpected = big(cash?.expectedMinor);
        const declared = cash?.declaredMinor === null || cash === undefined ? 0n : big(cash.declaredMinor);
        const hasCash = cash !== undefined && big(cash.expectedMinor) !== 0n;
        const cashComplete = !hasCash || cash?.declarationStatus === 'COMPLETE';
        const hasUnresolved = unresolvedPayments.some((row) => row.currency === currency);
        const accounted = electronic + (cashComplete ? declared : declared);
        const net = netSales.get(currency) ?? 0n;
        return {
          currency,
          netSalesMinor: net.toString(),
          electronicNetTenderMinor: electronic.toString(),
          cashExpectedMinor: cashExpected.toString(),
          accountedTenderMinor: accounted.toString(),
          salesToTenderVarianceMinor: (accounted - net).toString(),
          conclusive: !hasUnresolved && cashComplete,
        };
      });
  }

  private async sourceVersion(source: RowSource, eventId: string): Promise<string> {
    const rows = await source.rows<VersionRow>(
      `WITH marks AS (
         SELECT
           (SELECT max(updated_at) FROM sync_order_state WHERE event_id=$1) AS orders_at,
           (SELECT count(*) FROM sync_order_state WHERE event_id=$1) AS orders_count,
           (SELECT max(created_at) FROM commerce_order_adjustments WHERE event_id::text=$1) AS adjustments_at,
           (SELECT count(*) FROM commerce_order_adjustments WHERE event_id::text=$1) AS adjustments_count,
           (SELECT max(attempt.updated_at)
              FROM payment_attempts attempt JOIN payments payment ON payment.id=attempt.payment_id
             WHERE payment.event_id=$1) AS attempts_at,
           (SELECT count(*) FROM payment_attempts attempt JOIN payments payment ON payment.id=attempt.payment_id
             WHERE payment.event_id=$1) AS attempts_count,
           (SELECT max(event.received_at)
              FROM payment_provider_events event
              JOIN payment_attempts attempt ON attempt.id=event.payment_attempt_id
              JOIN payments payment ON payment.id=attempt.payment_id
             WHERE payment.event_id=$1) AS provider_events_at,
           (SELECT count(*)
              FROM payment_provider_events event
              JOIN payment_attempts attempt ON attempt.id=event.payment_attempt_id
              JOIN payments payment ON payment.id=attempt.payment_id
             WHERE payment.event_id=$1) AS provider_events_count,
           (SELECT max(refund.updated_at) FROM payment_refunds refund JOIN payments payment ON payment.id=refund.payment_id
             WHERE payment.event_id=$1) AS refunds_at,
           (SELECT count(*) FROM payment_refunds refund JOIN payments payment ON payment.id=refund.payment_id
             WHERE payment.event_id=$1) AS refunds_count,
           (SELECT max(reversal.updated_at) FROM payment_reversals reversal JOIN payments payment ON payment.id=reversal.payment_id
             WHERE payment.event_id=$1) AS reversals_at,
           (SELECT count(*) FROM payment_reversals reversal JOIN payments payment ON payment.id=reversal.payment_id
             WHERE payment.event_id=$1) AS reversals_count,
           (SELECT max(declared_at) FROM event_cash_declarations WHERE event_id::text=$1) AS cash_at,
           (SELECT count(*) FROM event_cash_declarations WHERE event_id::text=$1) AS cash_count,
           (SELECT max(declared_at) FROM event_inventory_unit_cost_declarations WHERE event_id::text=$1) AS costs_at,
           (SELECT count(*) FROM event_inventory_unit_cost_declarations WHERE event_id::text=$1) AS costs_count,
           (SELECT max(updated_at) FROM inventory_count_projection WHERE event_id=$1) AS counts_at,
           (SELECT count(*) FROM inventory_count_projection WHERE event_id=$1) AS counts_count,
           (SELECT max(created_at) FROM inventory_ledger WHERE event_id=$1) AS inventory_at,
           (SELECT count(*) FROM inventory_ledger WHERE event_id=$1) AS inventory_count,
           (SELECT max(source_updated_at) FROM inventory_transfer_projection WHERE event_id=$1) AS transfers_at,
           (SELECT count(*) FROM inventory_transfer_projection WHERE event_id=$1) AS transfers_count,
           (SELECT max(updated_at) FROM inventory_alert_projection WHERE event_id=$1) AS alerts_at,
           (SELECT count(*) FROM inventory_alert_projection WHERE event_id=$1) AS alerts_count,
           (SELECT max(updated_at) FROM command_centre_inventory_alert_control WHERE event_id::text=$1) AS control_at,
           (SELECT count(*) FROM command_centre_inventory_alert_control WHERE event_id::text=$1) AS control_count
       )
       SELECT md5(concat_ws('|',
         coalesce(orders_at::text,''),orders_count::text,
         coalesce(adjustments_at::text,''),adjustments_count::text,
         coalesce(attempts_at::text,''),attempts_count::text,
         coalesce(provider_events_at::text,''),provider_events_count::text,
         coalesce(refunds_at::text,''),refunds_count::text,
         coalesce(reversals_at::text,''),reversals_count::text,
         coalesce(cash_at::text,''),cash_count::text,
         coalesce(costs_at::text,''),costs_count::text,
         coalesce(counts_at::text,''),counts_count::text,
         coalesce(inventory_at::text,''),inventory_count::text,
         coalesce(transfers_at::text,''),transfers_count::text,
         coalesce(alerts_at::text,''),alerts_count::text,
         coalesce(control_at::text,''),control_count::text
       )) AS version_token FROM marks`,
      [eventId],
    );
    return rows[0]?.version_token ?? 'empty';
  }

  private databaseSource(): RowSource {
    return {
      rows: <T extends QueryResultRow>(sql: string, values: readonly unknown[] = []) =>
        this.database.query<T>(sql, values),
    };
  }

  private clientSource(client: PoolClient): RowSource {
    return {
      rows: async <T extends QueryResultRow>(sql: string, values: readonly unknown[] = []) =>
        (await client.query<T>(sql, [...values])).rows,
    };
  }
}
