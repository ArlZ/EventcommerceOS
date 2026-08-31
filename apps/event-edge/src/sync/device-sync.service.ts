import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import type {
  DeviceSyncAck,
  DeviceSyncBatch,
  SyncEventEnvelope,
  SyncEventReceipt,
} from '@event-commerce/contracts';
import { EdgeDatabaseService } from '../database/database.service';

interface ExistingEventRow extends QueryResultRow {
  event_instance_id: string;
  device_id: string;
  sequence: string;
  same_envelope: boolean;
}

interface SequenceRow extends QueryResultRow {
  event_instance_id: string;
}

interface WatermarkRow extends QueryResultRow {
  accepted_through_sequence: string;
}

interface SequenceValueRow extends QueryResultRow {
  sequence: string;
}

interface BlockingSequenceRow extends QueryResultRow {
  sequence: string | null;
}

interface CountRow extends QueryResultRow {
  count: string;
}

@Injectable()
export class DeviceSyncService {
  constructor(private readonly database: EdgeDatabaseService) {}

  async status(deviceId: string): Promise<DeviceSyncAck> {
    const [watermarks, backlog] = await Promise.all([
      this.database.query<WatermarkRow>(
        'SELECT accepted_through_sequence::text FROM edge_device_watermarks WHERE device_id = $1',
        [deviceId],
      ),
      this.database.query<CountRow>(
        'SELECT count(*)::text AS count FROM edge_cloud_outbox WHERE delivered_at IS NULL',
      ),
    ]);

    return {
      deviceId,
      acceptedThroughSequence: Number.parseInt(
        watermarks[0]?.accepted_through_sequence ?? '0',
        10,
      ),
      receipts: [],
      edgeBacklogCount: Number.parseInt(backlog[0]?.count ?? '0', 10),
      serverTime: new Date().toISOString(),
    };
  }

  async ingest(batch: DeviceSyncBatch): Promise<DeviceSyncAck> {
    const result = await this.database.transaction(async (client) => {
      const receipts: SyncEventReceipt[] = [];
      for (const event of batch.events) receipts.push(await this.persistEvent(client, event));

      const highest = Math.max(...batch.events.map((event) => event.sequence));
      await client.query(
        `INSERT INTO edge_device_watermarks(device_id, highest_sequence_seen, last_seen_at)
         VALUES ($1, $2, now())
         ON CONFLICT (device_id) DO UPDATE SET
           highest_sequence_seen = GREATEST(edge_device_watermarks.highest_sequence_seen, EXCLUDED.highest_sequence_seen),
           last_seen_at = now()`,
        [batch.deviceId, highest],
      );

      const durableWatermark = await this.advanceWatermark(client, batch.deviceId);
      const blocking = await client.query<BlockingSequenceRow>(
        `SELECT MIN(sequence)::text AS sequence
         FROM edge_reconciliation_exceptions
         WHERE device_id = $1
           AND resolved_at IS NULL
           AND sequence IS NOT NULL
           AND exception_type IN ('DEVICE_SEQUENCE_REUSE', 'EVENT_INSTANCE_REUSE')`,
        [batch.deviceId],
      );
      const blockingSequence = blocking.rows[0]?.sequence
        ? Number.parseInt(blocking.rows[0].sequence, 10)
        : null;
      const acceptedThroughSequence =
        blockingSequence === null
          ? durableWatermark
          : Math.min(durableWatermark, Math.max(0, blockingSequence - 1));

      await client.query(
        'UPDATE edge_device_watermarks SET accepted_through_sequence = $2 WHERE device_id = $1',
        [batch.deviceId, acceptedThroughSequence],
      );

      const backlog = await client.query<CountRow>(
        'SELECT count(*)::text AS count FROM edge_cloud_outbox WHERE delivered_at IS NULL',
      );
      return {
        receipts,
        acceptedThroughSequence,
        edgeBacklogCount: Number.parseInt(backlog.rows[0]!.count, 10),
      };
    });

    return {
      deviceId: batch.deviceId,
      acceptedThroughSequence: result.acceptedThroughSequence,
      receipts: result.receipts,
      edgeBacklogCount: result.edgeBacklogCount,
      serverTime: new Date().toISOString(),
    };
  }

  private async persistEvent(
    client: PoolClient,
    event: SyncEventEnvelope,
  ): Promise<SyncEventReceipt> {
    const envelope = JSON.stringify(event);
    const inserted = await client.query<{ event_instance_id: string }>(
      `INSERT INTO edge_processed_device_events(
         event_instance_id, event_id, event_type, aggregate_type, aggregate_id, event_version,
         device_id, sequence, occurred_at, idempotency_key, payload, envelope
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb)
       ON CONFLICT DO NOTHING
       RETURNING event_instance_id`,
      [
        event.eventInstanceId,
        event.eventId,
        event.eventType,
        event.aggregateType,
        event.aggregateId,
        event.eventVersion,
        event.deviceId,
        event.sequence,
        event.occurredAt,
        event.idempotencyKey,
        JSON.stringify(event.payload),
        envelope,
      ],
    );

    if (inserted.rowCount === 1) {
      await client.query(
        `INSERT INTO edge_cloud_outbox(event_instance_id, device_id, sequence, envelope)
         VALUES ($1,$2,$3,$4::jsonb)`,
        [event.eventInstanceId, event.deviceId, event.sequence, envelope],
      );
      return { eventInstanceId: event.eventInstanceId, status: 'ACCEPTED' };
    }

    const existing = await client.query<ExistingEventRow>(
      `SELECT event_instance_id, device_id, sequence::text,
              (envelope = $2::jsonb) AS same_envelope
       FROM edge_processed_device_events WHERE event_instance_id = $1`,
      [event.eventInstanceId, envelope],
    );
    if (existing.rowCount === 1) {
      if (existing.rows[0]!.same_envelope) {
        return { eventInstanceId: event.eventInstanceId, status: 'DUPLICATE' };
      }
      await this.exception(client, 'EVENT_INSTANCE_REUSE', event, {
        existingDeviceId: existing.rows[0]!.device_id,
        existingSequence: existing.rows[0]!.sequence,
      });
      return {
        eventInstanceId: event.eventInstanceId,
        status: 'CONFLICT',
        reason: 'event instance ID was reused with different content',
      };
    }

    const sequence = await client.query<SequenceRow>(
      'SELECT event_instance_id FROM edge_processed_device_events WHERE device_id = $1 AND sequence = $2',
      [event.deviceId, event.sequence],
    );
    await this.exception(client, 'DEVICE_SEQUENCE_REUSE', event, {
      existingEventInstanceId: sequence.rows[0]?.event_instance_id ?? null,
    });
    return {
      eventInstanceId: event.eventInstanceId,
      status: 'CONFLICT',
      reason: 'device sequence was already used by another event',
    };
  }

  private async advanceWatermark(client: PoolClient, deviceId: string): Promise<number> {
    const currentResult = await client.query<WatermarkRow>(
      'SELECT accepted_through_sequence::text FROM edge_device_watermarks WHERE device_id = $1 FOR UPDATE',
      [deviceId],
    );
    let watermark = Number.parseInt(currentResult.rows[0]?.accepted_through_sequence ?? '0', 10);
    const sequences = await client.query<SequenceValueRow>(
      `SELECT sequence::text FROM edge_processed_device_events
       WHERE device_id = $1 AND sequence > $2
       ORDER BY edge_processed_device_events.sequence ASC`,
      [deviceId, watermark],
    );
    for (const row of sequences.rows) {
      const sequence = Number.parseInt(row.sequence, 10);
      if (sequence !== watermark + 1) break;
      watermark = sequence;
    }
    return watermark;
  }

  private async exception(
    client: PoolClient,
    type: string,
    event: SyncEventEnvelope,
    details: Record<string, unknown>,
  ): Promise<void> {
    await client.query(
      `INSERT INTO edge_reconciliation_exceptions(
         id, exception_type, device_id, sequence, event_instance_id, details
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [
        randomUUID(),
        type,
        event.deviceId,
        event.sequence,
        event.eventInstanceId,
        JSON.stringify(details),
      ],
    );
  }
}
