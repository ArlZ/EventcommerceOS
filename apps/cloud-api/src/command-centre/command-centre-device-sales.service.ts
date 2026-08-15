import { Inject, Injectable } from '@nestjs/common';
import type {
  CommandCentreCurrencyAmount,
  CommandCentreCurrencyVelocity,
  CommandCentreSnapshot,
} from '@event-commerce/contracts';
import type { QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';

interface DeviceSalesRow extends QueryResultRow {
  device_id: string;
  currency: string;
  transaction_count: string;
  gross_minor: string;
  velocity_minor_per_minute: string;
}

@Injectable()
export class CommandCentreDeviceSalesService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async enrich(eventId: string, snapshot: CommandCentreSnapshot): Promise<CommandCentreSnapshot> {
    const rows = await this.database.query<DeviceSalesRow>(
      `SELECT device_id,
              currency,
              count(*)::text AS transaction_count,
              coalesce(sum(total_minor),0)::text AS gross_minor,
              coalesce(round(
                coalesce(sum(total_minor) FILTER (
                  WHERE occurred_at >= now() - interval '15 minutes'
                ),0)::numeric / 15
              ),0)::bigint::text AS velocity_minor_per_minute
       FROM sync_order_state
       WHERE event_id = $1 AND state = 'CLOSED'
       GROUP BY device_id, currency
       ORDER BY device_id, currency`,
      [eventId],
    );

    const byDevice = new Map<
      string,
      {
        transactionCount: number;
        grossSales: CommandCentreCurrencyAmount[];
        currentSalesVelocity: CommandCentreCurrencyVelocity[];
      }
    >();
    for (const row of rows) {
      const current = byDevice.get(row.device_id) ?? {
        transactionCount: 0,
        grossSales: [],
        currentSalesVelocity: [],
      };
      current.transactionCount += Number(row.transaction_count);
      current.grossSales.push({ currency: row.currency, amountMinor: row.gross_minor });
      current.currentSalesVelocity.push({
        currency: row.currency,
        amountMinorPerMinute: row.velocity_minor_per_minute,
      });
      byDevice.set(row.device_id, current);
    }

    return {
      ...snapshot,
      devices: snapshot.devices.map((device) => ({
        ...device,
        ...(byDevice.get(device.deviceId) ?? {
          transactionCount: 0,
          grossSales: [],
          currentSalesVelocity: [],
        }),
      })),
    };
  }
}
