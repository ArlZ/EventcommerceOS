import type { QueryResultRow } from 'pg';
import type { DeviceSyncAck, DeviceSyncBatch } from '@event-commerce/contracts';
import type { EdgeDatabaseService } from '../database/database.service';
import type { DeviceSyncService } from './device-sync.service';

interface WatermarkRow extends QueryResultRow {
  watermark: string;
}

export class SafeDeviceSyncService {
  constructor(
    private readonly inner: DeviceSyncService,
    private readonly database: EdgeDatabaseService,
  ) {}

  async ingest(batch: DeviceSyncBatch): Promise<DeviceSyncAck> {
    const acknowledgement = await this.inner.ingest(batch);
    const durableWatermark = await this.database.transaction(async (client) => {
      const rows = await client.query<WatermarkRow>(
        `SELECT COALESCE(MAX(sequence), 0)::text AS watermark
         FROM (
           SELECT sequence, row_number() OVER (ORDER BY sequence) AS position
           FROM edge_processed_device_events
           WHERE device_id = $1
         ) ordered
         WHERE sequence = position`,
        [batch.deviceId],
      );
      const contiguous = Number.parseInt(rows.rows[0]?.watermark ?? '0', 10);
      const firstConflict = acknowledgement.receipts.reduce<number | null>(
        (lowest, receipt, index) => {
          if (receipt.status !== 'CONFLICT') return lowest;
          const sequence = batch.events[index]!.sequence;
          return lowest === null ? sequence : Math.min(lowest, sequence);
        },
        null,
      );
      const safe =
        firstConflict === null ? contiguous : Math.min(contiguous, Math.max(0, firstConflict - 1));
      await client.query(
        'UPDATE edge_device_watermarks SET accepted_through_sequence = $2 WHERE device_id = $1',
        [batch.deviceId, safe],
      );
      return safe;
    });
    return { ...acknowledgement, acceptedThroughSequence: durableWatermark };
  }
}
