import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type {
  EventCloseActionRequest,
  EventCloseActionView,
  EventCloseReport,
  EventCloseStoredReportView,
} from '@event-commerce/contracts';
import type { PoolClient, QueryResultRow } from 'pg';
import { assertOrganisationAccess, type AdminContext } from '../configuration/admin-context';
import { DatabaseService } from '../database/database.service';
import {
  EventCloseReportService,
  type EventCloseEventMeta,
} from './event-close-report.service';

interface EventRow extends QueryResultRow {
  id: string;
  organisation_id: string;
  name: string;
  timezone: string;
  lifecycle: string;
}

interface ActionRow extends QueryResultRow {
  id: string;
  event_id: string;
  action: 'OPERATIONALLY_CLOSE' | 'REOPEN';
  actor_id: string;
  reason: string;
  report_id: string | null;
  close_revision: number | null;
  created_at: Date | string;
}

interface ReportRow extends QueryResultRow {
  id: string;
  event_id: string;
  revision: number;
  source_version_token: string;
  report_json: EventCloseReport;
  report_sha256: string;
  created_by_actor_id: string;
  created_at: Date | string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function actionView(row: ActionRow): EventCloseActionView {
  return {
    actionId: row.id,
    eventId: row.event_id,
    action: row.action,
    actorId: row.actor_id,
    reason: row.reason,
    reportId: row.report_id,
    closeRevision: row.close_revision,
    createdAt: iso(row.created_at),
  };
}

function reportView(row: ReportRow): EventCloseStoredReportView {
  return {
    reportId: row.id,
    eventId: row.event_id,
    revision: row.revision,
    sourceVersionToken: row.source_version_token,
    sha256: row.report_sha256,
    createdByActorId: row.created_by_actor_id,
    createdAt: iso(row.created_at),
    report: row.report_json,
  };
}

@Injectable()
export class EventCloseService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(EventCloseReportService) private readonly reports: EventCloseReportService,
  ) {}

  async liveReport(context: AdminContext, eventId: string): Promise<EventCloseReport> {
    const event = await this.eventFor(context, eventId);
    return this.reports.buildLive(event);
  }

  async operationallyClose(
    context: AdminContext,
    eventId: string,
    request: EventCloseActionRequest,
  ): Promise<EventCloseStoredReportView> {
    return this.database.transaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`event-close:${eventId}`]);
      const event = await this.eventForClient(client, context, eventId);

      const existing = await this.actionById(client, request.actionId);
      if (existing) {
        this.assertSameAction(existing, eventId, context, 'OPERATIONALLY_CLOSE', request.reason);
        if (!existing.report_id) throw new ConflictException('Existing close action has no report');
        const stored = await this.reportByIdClient(client, existing.report_id);
        if (!stored) throw new NotFoundException('Stored close report is missing');
        return reportView(stored);
      }

      const latest = await this.latestAction(client, eventId);
      if (latest?.action === 'OPERATIONALLY_CLOSE') {
        throw new ConflictException(
          'Event is already operationally closed; reopen before re-closing',
        );
      }

      const revisionResult = await client.query<{ revision: number }>(
        `SELECT coalesce(max(revision),0)+1 AS revision
         FROM event_close_reports WHERE event_id=$1`,
        [eventId],
      );
      const revision = Number(revisionResult.rows[0]?.revision ?? 1);
      const reportId = randomUUID();
      const generatedAt = new Date().toISOString();
      const live = await this.reports.buildInTransaction(client, event, generatedAt);
      const closedReport: EventCloseReport = {
        ...live,
        close: {
          state: 'OPERATIONALLY_CLOSED',
          lastActionAt: generatedAt,
          lastClosedAt: generatedAt,
          lastClosedRevision: revision,
          lastClosedReportId: reportId,
          sourceVersionAtLastClose: live.sourceVersionToken,
          sourceChangedSinceLastClose: false,
        },
      };
      const serialized = JSON.stringify(closedReport);
      const sha256 = createHash('sha256').update(serialized).digest('hex');

      const insertedReport = await client.query<ReportRow>(
        `INSERT INTO event_close_reports(
           id,organisation_id,event_id,revision,source_version_token,report_json,
           report_sha256,created_by_actor_id,created_at
         ) VALUES ($1,$2,$3,$4,$5,$6::json,$7,$8,$9)
         RETURNING id::text,event_id::text,revision,source_version_token,report_json,
                   report_sha256,created_by_actor_id::text,created_at`,
        [
          reportId,
          event.organisationId,
          eventId,
          revision,
          live.sourceVersionToken,
          serialized,
          sha256,
          context.actorId,
          generatedAt,
        ],
      );
      await client.query(
        `INSERT INTO event_close_actions(
           id,organisation_id,event_id,action,actor_id,reason,report_id,close_revision,created_at
         ) VALUES ($1,$2,$3,'OPERATIONALLY_CLOSE',$4,$5,$6,$7,$8)`,
        [
          request.actionId,
          event.organisationId,
          eventId,
          context.actorId,
          request.reason,
          reportId,
          revision,
          generatedAt,
        ],
      );
      return reportView(insertedReport.rows[0]!);
    });
  }

  async reopen(
    context: AdminContext,
    eventId: string,
    request: EventCloseActionRequest,
  ): Promise<EventCloseActionView> {
    return this.database.transaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`event-close:${eventId}`]);
      const event = await this.eventForClient(client, context, eventId);
      const existing = await this.actionById(client, request.actionId);
      if (existing) {
        this.assertSameAction(existing, eventId, context, 'REOPEN', request.reason);
        return actionView(existing);
      }
      const latest = await this.latestAction(client, eventId);
      if (!latest || latest.action !== 'OPERATIONALLY_CLOSE') {
        throw new ConflictException('Only an operationally closed event can be reopened');
      }
      const inserted = await client.query<ActionRow>(
        `INSERT INTO event_close_actions(
           id,organisation_id,event_id,action,actor_id,reason,created_at
         ) VALUES ($1,$2,$3,'REOPEN',$4,$5,$6)
         RETURNING id,event_id::text,action,actor_id::text,reason,report_id,
                   close_revision,created_at`,
        [
          request.actionId,
          event.organisationId,
          eventId,
          context.actorId,
          request.reason,
          new Date().toISOString(),
        ],
      );
      return actionView(inserted.rows[0]!);
    });
  }

  async actions(context: AdminContext, eventId: string): Promise<EventCloseActionView[]> {
    await this.eventFor(context, eventId);
    const rows = await this.database.query<ActionRow>(
      `SELECT id,event_id::text,action,actor_id::text,reason,report_id::text,
              close_revision,created_at
       FROM event_close_actions WHERE event_id=$1
       ORDER BY created_at,id`,
      [eventId],
    );
    return rows.map(actionView);
  }

  async storedReports(
    context: AdminContext,
    eventId: string,
  ): Promise<EventCloseStoredReportView[]> {
    await this.eventFor(context, eventId);
    const rows = await this.database.query<ReportRow>(
      `${this.reportSelect()} WHERE event_id=$1 ORDER BY revision`,
      [eventId],
    );
    return rows.map(reportView);
  }

  async storedReport(
    context: AdminContext,
    eventId: string,
    revision: number,
  ): Promise<EventCloseStoredReportView> {
    await this.eventFor(context, eventId);
    const rows = await this.database.query<ReportRow>(
      `${this.reportSelect()} WHERE event_id=$1 AND revision=$2`,
      [eventId, revision],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('Stored close report revision not found');
    return reportView(row);
  }

  csv(report: EventCloseReport): string {
    const rows: string[][] = [];
    const push = (...values: Array<string | number | boolean | null>): void => {
      rows.push(values.map((value) => (value === null ? '' : String(value))));
    };
    push(
      'SECTION',
      'KEY_1',
      'KEY_2',
      'CURRENCY',
      'VALUE_1',
      'VALUE_2',
      'STATUS',
      'DETAIL',
    );
    push(
      'META',
      'event_id',
      report.event.eventId,
      '',
      report.event.name,
      '',
      report.close.state,
      '',
    );
    push('META', 'generated_at', report.generatedAt, '', '', '', '', '');
    push('META', 'source_version', report.sourceVersionToken, '', '', '', '', '');
    push(
      'META',
      'source_changed_since_last_close',
      report.close.sourceChangedSinceLastClose,
      '',
      '',
      '',
      '',
      '',
    );
    for (const [label, values] of [
      ['gross_sales', report.sales.grossSales],
      ['discounts', report.sales.discounts],
      ['comps', report.sales.comps],
      ['voids', report.sales.voids],
      ['refunds', report.sales.refunds],
      ['net_sales', report.sales.netSales],
    ] as const) {
      values.forEach((value) =>
        push('SALES', label, '', value.currency, value.amountMinor, '', '', ''),
      );
    }
    report.paymentMethods.forEach((method) =>
      push(
        'PAYMENT_METHOD',
        method.methodId,
        '',
        method.currency,
        method.grossTenderMinor,
        method.netTenderMinor,
        method.unresolvedAttemptCount > 0 ? 'UNRESOLVED' : 'RECONCILED',
        `refund=${method.refundMinor};reversal=${method.reversalMinor}`,
      ),
    );
    report.providerReconciliation.forEach((provider) =>
      push(
        'PROVIDER',
        provider.providerId,
        '',
        provider.currency,
        provider.succeededValueMinor,
        provider.unknownValueMinor,
        provider.transactionReconciliationStatus,
        provider.settlementStatus,
      ),
    );
    report.cash.scopes.forEach((scope) =>
      push(
        'CASH',
        scope.salesLocationId,
        `${scope.deviceId}|${scope.cashierId}`,
        scope.currency,
        scope.expectedMinor,
        scope.declaredMinor,
        scope.declarationStatus,
        scope.varianceMinor,
      ),
    );
    report.inventoryVariances.forEach((variance) =>
      push(
        'INVENTORY',
        variance.inventoryLocationId,
        variance.skuId,
        variance.valuationCurrency,
        variance.varianceQuantityBase,
        variance.varianceValueMinor,
        variance.valuationStatus,
        `expected=${variance.expectedQuantityBase};physical=${variance.physicalQuantityBase}`,
      ),
    );
    report.unresolvedPayments.forEach((payment) =>
      push(
        'UNRESOLVED_PAYMENT',
        payment.paymentAttemptId,
        payment.orderId,
        payment.currency,
        payment.amountMinor,
        payment.providerReference,
        payment.status,
        payment.reconciliationErrorCode ?? payment.failureCode,
      ),
    );
    report.openTransfers.forEach((transfer) =>
      push(
        'OPEN_TRANSFER',
        transfer.transferId,
        `${transfer.sourceLocationId}->${transfer.destinationLocationId}`,
        '',
        '',
        '',
        transfer.state,
        transfer.assignedActorId,
      ),
    );
    report.unresolvedCriticalAlerts.forEach((alert) =>
      push(
        'CRITICAL_ALERT',
        alert.alertId,
        alert.skuId,
        '',
        alert.availableQuantityBase,
        alert.minutesOfCover,
        alert.state,
        alert.alertType,
      ),
    );
    report.drilldowns.forEach((drilldown) =>
      push(
        'DRILLDOWN',
        drilldown.dimensionType,
        drilldown.dimensionId,
        drilldown.currency,
        drilldown.grossSalesMinor,
        drilldown.netSalesMinor,
        '',
        `transactions=${drilldown.transactionCount};discount=${drilldown.discountMinor};comp=${drilldown.compMinor};void=${drilldown.voidMinor};refund=${drilldown.refundMinor}`,
      ),
    );
    report.financialReconciliation.forEach((row) =>
      push(
        'FINANCIAL_RECONCILIATION',
        'sales_to_tender',
        '',
        row.currency,
        row.netSalesMinor,
        row.accountedTenderMinor,
        row.conclusive ? 'CONCLUSIVE' : 'UNRESOLVED',
        `variance=${row.salesToTenderVarianceMinor};cash_expected=${row.cashExpectedMinor};electronic=${row.electronicNetTenderMinor}`,
      ),
    );
    return rows.map((row) => row.map(this.csvCell).join(',')).join('\n') + '\n';
  }

  private csvCell(value: string): string {
    if (!/[",\n\r]/.test(value)) return value;
    return `"${value.replaceAll('"', '""')}"`;
  }

  private async eventFor(context: AdminContext, eventId: string): Promise<EventCloseEventMeta> {
    const rows = await this.database.query<EventRow>(
      `SELECT id::text,organisation_id::text,name,timezone,lifecycle FROM events WHERE id=$1`,
      [eventId],
    );
    const event = rows[0];
    if (!event) throw new NotFoundException('Event not found');
    assertOrganisationAccess(context, event.organisation_id);
    return {
      id: event.id,
      organisationId: event.organisation_id,
      name: event.name,
      timezone: event.timezone,
      lifecycle: event.lifecycle,
    };
  }

  private async eventForClient(
    client: PoolClient,
    context: AdminContext,
    eventId: string,
  ): Promise<EventCloseEventMeta> {
    const result = await client.query<EventRow>(
      `SELECT id::text,organisation_id::text,name,timezone,lifecycle FROM events WHERE id=$1`,
      [eventId],
    );
    const event = result.rows[0];
    if (!event) throw new NotFoundException('Event not found');
    assertOrganisationAccess(context, event.organisation_id);
    return {
      id: event.id,
      organisationId: event.organisation_id,
      name: event.name,
      timezone: event.timezone,
      lifecycle: event.lifecycle,
    };
  }

  private async latestAction(client: PoolClient, eventId: string): Promise<ActionRow | undefined> {
    const result = await client.query<ActionRow>(
      `SELECT id,event_id::text,action,actor_id::text,reason,report_id::text,
              close_revision,created_at
       FROM event_close_actions WHERE event_id=$1
       ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE`,
      [eventId],
    );
    return result.rows[0];
  }

  private async actionById(client: PoolClient, id: string): Promise<ActionRow | undefined> {
    const result = await client.query<ActionRow>(
      `SELECT id,event_id::text,action,actor_id::text,reason,report_id::text,
              close_revision,created_at
       FROM event_close_actions WHERE id=$1 FOR UPDATE`,
      [id],
    );
    return result.rows[0];
  }

  private assertSameAction(
    row: ActionRow,
    eventId: string,
    context: AdminContext,
    action: ActionRow['action'],
    reason: string,
  ): void {
    if (
      row.event_id !== eventId ||
      row.action !== action ||
      row.actor_id !== context.actorId ||
      row.reason !== reason
    ) {
      throw new ConflictException('Close action ID was reused for different content');
    }
  }

  private reportSelect(): string {
    return `SELECT id::text,event_id::text,revision,source_version_token,report_json,
                   report_sha256,created_by_actor_id::text,created_at
            FROM event_close_reports`;
  }

  private async reportByIdClient(
    client: PoolClient,
    reportId: string,
  ): Promise<ReportRow | undefined> {
    const result = await client.query<ReportRow>(`${this.reportSelect()} WHERE id=$1`, [reportId]);
    return result.rows[0];
  }
}
