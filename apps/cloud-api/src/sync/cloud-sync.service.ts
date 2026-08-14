import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import type { EdgeCloudAck, EdgeCloudBatch, SyncEventEnvelope } from '@event-commerce/contracts';
import { DatabaseService } from '../database/database.service';

interface ExistingEventRow extends QueryResultRow {
  same_envelope: boolean;
}

interface SequenceRow extends QueryResultRow {
  event_instance_id: string;
}

interface OrderStateRow extends QueryResultRow {
  device_id: string;
  last_sequence: string;
  state: string;
  event_id: string;
  sales_location_id: string | null;
}

interface OrderLineProjection {
  skuId: string;
  quantity: number;
  unitPriceMinor: number;
  menuItemId?: string;
}

interface OrderProjectionPayload {
  state: string;
  totalMinor: number;
  currency: string;
  eventId: string;
  salesLocationId: string | null;
  lines: OrderLineProjection[];
  linesProvided: boolean;
  occurredAt: string;
}

@Injectable()
export class CloudSyncService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async ingest(batch: EdgeCloudBatch): Promise<EdgeCloudAck> {
    const result = await this.database.transaction(async (client) => {
      const accepted: string[] = [];
      const duplicates: string[] = [];
      const conflicts: string[] = [];

      const deviceIds = [...new Set(batch.events.map((event) => event.deviceId))].sort();
      for (const deviceId of deviceIds) {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `sync-device:${deviceId}`,
        ]);
      }

      for (const event of batch.events) {
        const outcome = await this.processEvent(client, event);
        if (outcome === 'ACCEPTED') accepted.push(event.eventInstanceId);
        else if (outcome === 'DUPLICATE') duplicates.push(event.eventInstanceId);
        else conflicts.push(event.eventInstanceId);
      }

      for (const status of batch.deviceStatuses) {
        await client.query(
          `INSERT INTO sync_device_state(
             device_id, last_seen_at, last_sequence_seen, edge_accepted_through_sequence,
             edge_backlog_count, last_cloud_delivery_at
           ) VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (device_id) DO UPDATE SET
             last_seen_at = GREATEST(sync_device_state.last_seen_at, EXCLUDED.last_seen_at),
             last_sequence_seen = GREATEST(sync_device_state.last_sequence_seen, EXCLUDED.last_sequence_seen),
             edge_accepted_through_sequence = GREATEST(sync_device_state.edge_accepted_through_sequence, EXCLUDED.edge_accepted_through_sequence),
             edge_backlog_count = EXCLUDED.edge_backlog_count,
             last_cloud_delivery_at = COALESCE(EXCLUDED.last_cloud_delivery_at, sync_device_state.last_cloud_delivery_at)`,
          [
            status.deviceId,
            status.lastSeenAt,
            status.lastSequenceSeen,
            status.edgeAcceptedThroughSequence,
            status.edgeBacklogCount,
            status.lastCloudDeliveryAt,
          ],
        );
      }

      return { accepted, duplicates, conflicts };
    });

    return {
      acceptedEventInstanceIds: result.accepted,
      duplicateEventInstanceIds: result.duplicates,
      conflictEventInstanceIds: result.conflicts,
      serverTime: new Date().toISOString(),
    };
  }

  async deviceHealth(): Promise<
    Array<{
      deviceId: string;
      lastSeenAt: string;
      lastSequenceSeen: number;
      edgeAcceptedThroughSequence: number;
      edgeBacklogCount: number;
      lastCloudDeliveryAt: string | null;
    }>
  > {
    const rows = await this.database.query<{
      device_id: string;
      last_seen_at: Date;
      last_sequence_seen: string;
      edge_accepted_through_sequence: string;
      edge_backlog_count: number;
      last_cloud_delivery_at: Date | null;
    }>(
      `SELECT device_id, last_seen_at, last_sequence_seen::text, edge_accepted_through_sequence::text,
              edge_backlog_count, last_cloud_delivery_at
       FROM sync_device_state ORDER BY last_seen_at DESC`,
    );
    return rows.map((row) => ({
      deviceId: row.device_id,
      lastSeenAt: row.last_seen_at.toISOString(),
      lastSequenceSeen: Number.parseInt(row.last_sequence_seen, 10),
      edgeAcceptedThroughSequence: Number.parseInt(row.edge_accepted_through_sequence, 10),
      edgeBacklogCount: row.edge_backlog_count,
      lastCloudDeliveryAt: row.last_cloud_delivery_at?.toISOString() ?? null,
    }));
  }

  private async processEvent(
    client: PoolClient,
    event: SyncEventEnvelope,
  ): Promise<'ACCEPTED' | 'DUPLICATE' | 'CONFLICT'> {
    const envelope = JSON.stringify(event);
    const byInstance = await client.query<ExistingEventRow>(
      `SELECT (envelope = $2::jsonb) AS same_envelope
       FROM sync_processed_events WHERE event_instance_id = $1`,
      [event.eventInstanceId, envelope],
    );
    if (byInstance.rowCount === 1) {
      if (byInstance.rows[0]!.same_envelope) return 'DUPLICATE';
      await this.exception(client, 'EVENT_INSTANCE_REUSE', event, {});
      return 'CONFLICT';
    }

    const bySequence = await client.query<SequenceRow>(
      'SELECT event_instance_id FROM sync_processed_events WHERE device_id = $1 AND sequence = $2',
      [event.deviceId, event.sequence],
    );
    if (bySequence.rowCount === 1) {
      await this.exception(client, 'DEVICE_SEQUENCE_REUSE', event, {
        existingEventInstanceId: bySequence.rows[0]!.event_instance_id,
      });
      return 'CONFLICT';
    }

    await client.query(
      `INSERT INTO sync_processed_events(
         event_instance_id, event_id, event_type, aggregate_type, aggregate_id, event_version,
         device_id, sequence, occurred_at, idempotency_key, payload, envelope
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb)`,
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

    if (event.aggregateType !== 'ORDER') return 'ACCEPTED';
    return this.applyOrder(client, event);
  }

  private async applyOrder(
    client: PoolClient,
    event: SyncEventEnvelope,
  ): Promise<'ACCEPTED' | 'CONFLICT'> {
    let payload: OrderProjectionPayload;
    try {
      payload = this.orderPayload(event);
    } catch (error) {
      await this.exception(client, 'INVALID_ORDER_EVENT', event, {
        reason: error instanceof Error ? error.message : 'invalid synced order payload',
      });
      return 'CONFLICT';
    }

    const current = await client.query<OrderStateRow>(
      `SELECT device_id, last_sequence::text, state, event_id, sales_location_id
       FROM sync_order_state WHERE order_id = $1 FOR UPDATE`,
      [event.aggregateId],
    );

    if (current.rowCount === 0) {
      await client.query(
        `INSERT INTO sync_order_state(
           order_id, device_id, last_sequence, state, total_minor, currency,
           event_id, sales_location_id, lines, occurred_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
        [
          event.aggregateId,
          event.deviceId,
          event.sequence,
          payload.state,
          payload.totalMinor,
          payload.currency,
          payload.eventId,
          payload.salesLocationId,
          JSON.stringify(payload.lines),
          payload.occurredAt,
        ],
      );
      return 'ACCEPTED';
    }

    const existing = current.rows[0]!;
    if (existing.device_id !== event.deviceId) {
      await this.exception(client, 'ORDER_DEVICE_CONFLICT', event, {
        existingDeviceId: existing.device_id,
      });
      return 'CONFLICT';
    }

    const lastSequence = Number.parseInt(existing.last_sequence, 10);
    if (event.sequence <= lastSequence) return 'ACCEPTED';
    if (existing.event_id !== payload.eventId) {
      await this.exception(client, 'ORDER_EVENT_CONFLICT', event, {
        existingEventId: existing.event_id,
        incomingEventId: payload.eventId,
      });
      return 'CONFLICT';
    }
    if (
      existing.sales_location_id !== null &&
      payload.salesLocationId !== null &&
      existing.sales_location_id !== payload.salesLocationId
    ) {
      await this.exception(client, 'ORDER_LOCATION_CONFLICT', event, {
        existingSalesLocationId: existing.sales_location_id,
        incomingSalesLocationId: payload.salesLocationId,
      });
      return 'CONFLICT';
    }
    if (!this.safeOrderAdvance(existing.state, payload.state)) {
      await this.exception(client, 'ORDER_STATE_REGRESSION', event, {
        currentState: existing.state,
        incomingState: payload.state,
        currentSequence: lastSequence,
      });
      return 'CONFLICT';
    }

    await client.query(
      `UPDATE sync_order_state
       SET last_sequence = $2,
           state = $3,
           total_minor = $4,
           currency = $5,
           event_id = $6,
           sales_location_id = COALESCE($7, sales_location_id),
           lines = CASE WHEN $9 THEN $8::jsonb ELSE lines END,
           occurred_at = $10,
           updated_at = now()
       WHERE order_id = $1`,
      [
        event.aggregateId,
        event.sequence,
        payload.state,
        payload.totalMinor,
        payload.currency,
        payload.eventId,
        payload.salesLocationId,
        JSON.stringify(payload.lines),
        payload.linesProvided,
        payload.occurredAt,
      ],
    );
    return 'ACCEPTED';
  }

  private orderPayload(event: SyncEventEnvelope): OrderProjectionPayload {
    const state = event.payload.state;
    const totalMinor = event.payload.totalMinor;
    const currency = event.payload.currency;
    if (typeof state !== 'string' || !['OPEN', 'CLOSED'].includes(state)) {
      throw new Error('unsupported synced order state');
    }
    if (!Number.isSafeInteger(totalMinor) || (totalMinor as number) < 0) {
      throw new Error('synced totalMinor must be a non-negative safe integer');
    }
    if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) {
      throw new Error('synced currency is invalid');
    }
    if (event.payload.orderId !== event.aggregateId) {
      throw new Error('payload orderId must equal aggregateId');
    }

    const eventIdValue = event.payload.eventId;
    const businessEventId =
      typeof eventIdValue === 'string' && eventIdValue.trim()
        ? eventIdValue.trim()
        : `legacy:${event.deviceId}`;
    const salesLocationValue = event.payload.salesLocationId;
    if (
      salesLocationValue !== undefined &&
      salesLocationValue !== null &&
      (typeof salesLocationValue !== 'string' || !salesLocationValue.trim())
    ) {
      throw new Error('synced salesLocationId must be a non-empty string when provided');
    }
    const salesLocationId =
      typeof salesLocationValue === 'string' ? salesLocationValue.trim() : null;

    const rawLines = event.payload.lines;
    const linesProvided = rawLines !== undefined;
    const lines: OrderLineProjection[] = [];
    if (linesProvided) {
      if (!Array.isArray(rawLines)) throw new Error('synced lines must be an array');
      rawLines.forEach((line, index) => {
        if (!line || typeof line !== 'object' || Array.isArray(line)) {
          throw new Error(`synced lines[${index}] must be an object`);
        }
        const record = line as Record<string, unknown>;
        const skuId = record.skuId;
        const quantity = record.quantity;
        const unitPriceMinor = record.unitPriceMinor;
        const menuItemId = record.menuItemId;
        if (typeof skuId !== 'string' || !skuId.trim()) {
          throw new Error(`synced lines[${index}].skuId must be non-empty`);
        }
        if (!Number.isSafeInteger(quantity) || (quantity as number) <= 0) {
          throw new Error(`synced lines[${index}].quantity must be a positive safe integer`);
        }
        if (!Number.isSafeInteger(unitPriceMinor) || (unitPriceMinor as number) < 0) {
          throw new Error(
            `synced lines[${index}].unitPriceMinor must be a non-negative safe integer`,
          );
        }
        if (
          menuItemId !== undefined &&
          (typeof menuItemId !== 'string' || !menuItemId.trim())
        ) {
          throw new Error(`synced lines[${index}].menuItemId must be non-empty when provided`);
        }
        lines.push({
          skuId: skuId.trim(),
          quantity: quantity as number,
          unitPriceMinor: unitPriceMinor as number,
          ...(typeof menuItemId === 'string' ? { menuItemId: menuItemId.trim() } : {}),
        });
      });
    }

    return {
      state,
      totalMinor: totalMinor as number,
      currency,
      eventId: businessEventId,
      salesLocationId,
      lines,
      linesProvided,
      occurredAt: event.occurredAt,
    };
  }

  private safeOrderAdvance(current: string, incoming: string): boolean {
    if (current === 'OPEN') return incoming === 'OPEN' || incoming === 'CLOSED';
    if (current === 'CLOSED') return incoming === 'CLOSED';
    return false;
  }

  private async exception(
    client: PoolClient,
    type: string,
    event: SyncEventEnvelope,
    details: Record<string, unknown>,
  ): Promise<void> {
    await client.query(
      `INSERT INTO sync_reconciliation_exceptions(
         id, exception_type, event_instance_id, device_id, aggregate_id, details
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [
        randomUUID(),
        type,
        event.eventInstanceId,
        event.deviceId,
        event.aggregateId,
        JSON.stringify(details),
      ],
    );
  }
}
