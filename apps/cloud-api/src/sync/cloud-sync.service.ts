import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import type { EdgeCloudAck, EdgeCloudBatch, SyncEventEnvelope } from '@event-commerce/contracts';
import { DatabaseService } from '../database/database.service';
import type { EdgeSyncIdentity } from './edge-sync-auth.service';

interface ExistingEventRow extends QueryResultRow {
  same_envelope: boolean;
  edge_id: string | null;
  organisation_id: string | null;
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
  close_method: string | null;
  cashier_id: string | null;
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
  closeMethod: 'CASH' | 'PROVIDER' | 'UNKNOWN' | null;
  cashierId: string | null;
  lines: OrderLineProjection[];
  linesProvided: boolean;
  occurredAt: string;
}

@Injectable()
export class CloudSyncService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async ingest(batch: EdgeCloudBatch, identity: EdgeSyncIdentity): Promise<EdgeCloudAck> {
    const result = await this.database.transaction(async (client) => {
      const accepted: string[] = [];
      const duplicates: string[] = [];
      const conflicts: string[] = [];

      const deviceIds = [...new Set(batch.events.map((event) => event.deviceId))].sort();
      for (const deviceId of deviceIds) {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `sync-device:${identity.organisationId}:${deviceId}`,
        ]);
      }

      for (const event of batch.events) {
        const outcome = await this.processEvent(client, event, identity);
        if (outcome === 'ACCEPTED') accepted.push(event.eventInstanceId);
        else if (outcome === 'DUPLICATE') duplicates.push(event.eventInstanceId);
        else conflicts.push(event.eventInstanceId);
      }

      for (const status of batch.deviceStatuses) {
        const deviceState = await client.query(
          `INSERT INTO sync_device_state(
             device_id, last_seen_at, last_sequence_seen, edge_accepted_through_sequence,
             edge_backlog_count, last_cloud_delivery_at, edge_id, organisation_id
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (device_id) DO UPDATE SET
             last_seen_at = GREATEST(sync_device_state.last_seen_at, EXCLUDED.last_seen_at),
             last_sequence_seen = GREATEST(sync_device_state.last_sequence_seen, EXCLUDED.last_sequence_seen),
             edge_accepted_through_sequence = GREATEST(sync_device_state.edge_accepted_through_sequence, EXCLUDED.edge_accepted_through_sequence),
             edge_backlog_count = EXCLUDED.edge_backlog_count,
             last_cloud_delivery_at = COALESCE(EXCLUDED.last_cloud_delivery_at, sync_device_state.last_cloud_delivery_at),
             edge_id = EXCLUDED.edge_id,
             organisation_id = EXCLUDED.organisation_id
           WHERE sync_device_state.organisation_id IS NULL
              OR sync_device_state.organisation_id = EXCLUDED.organisation_id
           RETURNING device_id`,
          [
            status.deviceId,
            status.lastSeenAt,
            status.lastSequenceSeen,
            status.edgeAcceptedThroughSequence,
            status.edgeBacklogCount,
            status.lastCloudDeliveryAt,
            identity.edgeId,
            identity.organisationId,
          ],
        );
        if (deviceState.rowCount !== 1) {
          throw new ConflictException(
            `device ${status.deviceId} is already attributed to another organisation`,
          );
        }
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

  private async processEvent(
    client: PoolClient,
    event: SyncEventEnvelope,
    identity: EdgeSyncIdentity,
  ): Promise<'ACCEPTED' | 'DUPLICATE' | 'CONFLICT'> {
    const envelope = JSON.stringify(event);
    const byInstance = await client.query<ExistingEventRow>(
      `SELECT (envelope = $2::jsonb) AS same_envelope,edge_id,organisation_id::text
       FROM sync_processed_events WHERE event_instance_id = $1`,
      [event.eventInstanceId, envelope],
    );
    if (byInstance.rowCount === 1) {
      const existing = byInstance.rows[0]!;
      if (
        existing.same_envelope &&
        (existing.organisation_id === null || existing.organisation_id === identity.organisationId)
      ) {
        return 'DUPLICATE';
      }
      await this.exception(client, 'EVENT_INSTANCE_REUSE', event, {
        existingEdgeId: existing.edge_id,
        authenticatedEdgeId: identity.edgeId,
      });
      return 'CONFLICT';
    }

    const bySequence = await client.query<SequenceRow>(
      `SELECT event_instance_id FROM sync_processed_events
       WHERE organisation_id=$1 AND device_id=$2 AND sequence=$3`,
      [identity.organisationId, event.deviceId, event.sequence],
    );
    if (bySequence.rowCount === 1) {
      await this.exception(client, 'DEVICE_SEQUENCE_REUSE', event, {
        existingEventInstanceId: bySequence.rows[0]!.event_instance_id,
        authenticatedEdgeId: identity.edgeId,
      });
      return 'CONFLICT';
    }

    await client.query(
      `INSERT INTO sync_processed_events(
         event_instance_id, event_id, event_type, aggregate_type, aggregate_id, event_version,
         device_id, sequence, occurred_at, idempotency_key, payload, envelope, edge_id, organisation_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14)`,
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
        identity.edgeId,
        identity.organisationId,
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
      `SELECT device_id, last_sequence::text, state, event_id, sales_location_id,
              close_method, cashier_id
       FROM sync_order_state WHERE order_id = $1 FOR UPDATE`,
      [event.aggregateId],
    );

    if (current.rowCount === 0) {
      await client.query(
        `INSERT INTO sync_order_state(
           order_id, device_id, last_sequence, state, total_minor, currency,
           event_id, sales_location_id, lines, occurred_at, close_method, cashier_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12)`,
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
          payload.closeMethod,
          payload.cashierId,
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
    if (
      existing.close_method !== null &&
      payload.closeMethod !== null &&
      existing.close_method !== payload.closeMethod
    ) {
      await this.exception(client, 'ORDER_CLOSE_METHOD_CONFLICT', event, {
        existingCloseMethod: existing.close_method,
        incomingCloseMethod: payload.closeMethod,
      });
      return 'CONFLICT';
    }
    if (
      existing.cashier_id !== null &&
      payload.cashierId !== null &&
      existing.cashier_id !== payload.cashierId
    ) {
      await this.exception(client, 'ORDER_CASHIER_CONFLICT', event, {
        existingCashierId: existing.cashier_id,
        incomingCashierId: payload.cashierId,
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
           close_method = COALESCE($11, close_method),
           cashier_id = COALESCE($12, cashier_id),
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
        payload.closeMethod,
        payload.cashierId,
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
    if (typeof eventIdValue !== 'string' || !eventIdValue.trim()) {
      throw new Error('synced eventId is required');
    }
    const businessEventId = eventIdValue.trim();
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

    const cashierValue = event.payload.cashierId;
    if (
      cashierValue !== undefined &&
      cashierValue !== null &&
      (typeof cashierValue !== 'string' || !cashierValue.trim())
    ) {
      throw new Error('synced cashierId must be a non-empty string when provided');
    }
    const cashierId = typeof cashierValue === 'string' ? cashierValue.trim() : null;

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

    const closeMethod: OrderProjectionPayload['closeMethod'] =
      state !== 'CLOSED'
        ? null
        : event.eventType === 'ORDER_CLOSED_CASH'
          ? 'CASH'
          : event.eventType === 'ORDER_CLOSED_PROVIDER'
            ? 'PROVIDER'
            : 'UNKNOWN';

    return {
      state,
      totalMinor: totalMinor as number,
      currency,
      eventId: businessEventId,
      salesLocationId,
      closeMethod,
      cashierId,
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
