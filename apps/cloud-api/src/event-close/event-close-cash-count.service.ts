import { Inject, Injectable } from '@nestjs/common';
import type { EventCloseReport } from '@event-commerce/contracts';
import type { PoolClient, QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';

interface CashCountRow extends QueryResultRow {
  currency: string;
  transaction_count: string;
}

@Injectable()
export class EventCloseCashCountService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async enrichLive(eventId: string, report: EventCloseReport): Promise<EventCloseReport> {
    const rows = await this.database.query<CashCountRow>(
      this.query(),
      [eventId],
    );
    return this.enrich(report, rows);
  }

  async enrichInTransaction(
    client: PoolClient,
    eventId: string,
    report: EventCloseReport,
  ): Promise<EventCloseReport> {
    const result = await client.query<CashCountRow>(this.query(), [eventId]);
    return this.enrich(report, result.rows);
  }

  private query(): string {
    return `SELECT currency,count(*)::text AS transaction_count
            FROM sync_order_state
            WHERE event_id=$1 AND state='CLOSED' AND close_method='CASH'
            GROUP BY currency ORDER BY currency`;
  }

  private enrich(report: EventCloseReport, rows: CashCountRow[]): EventCloseReport {
    const counts = new Map(rows.map((row) => [row.currency, Number(row.transaction_count)]));
    return {
      ...report,
      paymentMethods: report.paymentMethods.map((method) =>
        method.methodId === 'cash'
          ? { ...method, succeededCount: counts.get(method.currency) ?? 0 }
          : method,
      ),
    };
  }
}
