import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import {
  blendedVelocityPerMinute,
  evaluateStockRisk,
  minutesOfCover,
  recommendedTransferQuantity,
  requireAlertTransition,
} from '@event-commerce/domain';
import { EdgeDatabaseService } from '../database/database.service';
import { InventoryAuthorizationService } from './inventory-authorization.service';
import type { AlertTransitionInput, InventoryAlertRow } from './inventory.types';

interface EventConfigRow extends QueryResultRow {
  event_end_at: Date;
  short_window_minutes: number;
  medium_window_minutes: number;
  short_weight_basis_points: number;
  escalation_minutes: number;
}

interface AlertConfigRow extends QueryResultRow {
  id: string;
  event_id: string;
  inventory_location_id: string | null;
  sku_id: string;
  category: string | null;
  absolute_minimum: string;
  minutes_cover_threshold: string;
  target_cover_minutes: string;
  source_safety_stock: string;
  event_wide_safety_stock: string;
  imbalance_ratio: string;
}

interface QuantityRow extends QueryResultRow {
  quantity: string;
}

interface ConsumptionRow extends QueryResultRow {
  quantity: string;
  occurred_at: Date;
}

interface SourceRow extends QueryResultRow {
  inventory_location_id: string;
  available: string;
  safety_stock: string;
}

interface ResponsibilityRow extends QueryResultRow {
  responsible_actor_id: string;
  escalation_actor_id: string | null;
}

interface AlertDbRow extends QueryResultRow {
  id: string;
  dedupe_key: string;
  alert_type: string;
  severity: string;
  state: 'OPEN' | 'ACKNOWLEDGED' | 'ASSIGNED' | 'RESOLVED';
  event_id: string;
  inventory_location_id: string | null;
  sku_id: string;
  available_quantity: string;
  minutes_of_cover: string | null;
  suggested_source_location_id: string | null;
  suggested_transfer_quantity: string | null;
  responsible_actor_id: string | null;
  assigned_actor_id: string | null;
  opened_at: Date;
  escalate_at: Date | null;
  details: Record<string, unknown>;
}

@Injectable()
export class InventoryAlertService {
  constructor(
    @Inject(EdgeDatabaseService) private readonly database: EdgeDatabaseService,
    @Inject(InventoryAuthorizationService)
    private readonly authorization: InventoryAuthorizationService,
  ) {}

  async evaluateEvent(eventId: string, now = new Date()): Promise<void> {
    const configRows = await this.database.query<EventConfigRow>(
      'SELECT * FROM edge_inventory_event_config WHERE event_id = $1',
      [eventId],
    );
    if (configRows.length !== 1) return;
    const eventConfig = configRows[0]!;
    const alertConfigs = await this.database.query<AlertConfigRow>(
      `SELECT c.*, s.category
       FROM edge_inventory_alert_config c
       JOIN edge_inventory_skus s ON s.event_id = c.event_id AND s.sku_id = c.sku_id
       WHERE c.event_id = $1 AND c.enabled = true
       ORDER BY c.sku_id, c.inventory_location_id NULLS LAST`,
      [eventId],
    );

    const eventWideDone = new Set<string>();
    for (const config of alertConfigs) {
      if (config.inventory_location_id) {
        await this.evaluateLocation(config, eventConfig, now);
      }
      if (!eventWideDone.has(config.sku_id)) {
        eventWideDone.add(config.sku_id);
        const eventWideConfig =
          alertConfigs.find(
            (candidate) =>
              candidate.sku_id === config.sku_id && candidate.inventory_location_id === null,
          ) ?? config;
        await this.evaluateEventWide(eventWideConfig, eventConfig, now);
      }
    }
  }

  async transition(alertId: string, input: AlertTransitionInput): Promise<InventoryAlertRow> {
    return this.database.transaction(async (client) => {
      const alert = await this.alert(client, alertId, true);
      await this.authorization.require(client, alert.event_id, input.actorId, 'ALERT_MANAGE');
      requireAlertTransition(alert.state, input.toState);
      if (input.toState === 'ASSIGNED' && !input.assignedActorId) {
        throw new Error('assignedActorId is required when assigning an inventory alert');
      }
      await client.query(
        `UPDATE edge_inventory_alerts SET
           state = $2,
           acknowledged_at = CASE WHEN $2 = 'ACKNOWLEDGED' THEN $3 ELSE acknowledged_at END,
           assigned_at = CASE WHEN $2 = 'ASSIGNED' THEN $3 ELSE assigned_at END,
           assigned_actor_id = CASE WHEN $2 = 'ASSIGNED' THEN $4 ELSE assigned_actor_id END,
           resolved_at = CASE WHEN $2 = 'RESOLVED' THEN $3 ELSE resolved_at END,
           updated_at = now()
         WHERE id = $1`,
        [alert.id, input.toState, input.occurredAt, input.assignedActorId ?? null],
      );
      await this.history(
        client,
        alert.id,
        alert.state,
        input.toState,
        input.actorId,
        input.reason,
        input.occurredAt,
      );
      const updated = await this.alert(client, alert.id, false);
      await this.queueCloud(client, updated);
      return this.map(updated);
    });
  }

  async runEscalations(eventId: string, now = new Date()): Promise<number> {
    return this.database.transaction(async (client) => {
      const eventConfig = await client.query<EventConfigRow>(
        'SELECT * FROM edge_inventory_event_config WHERE event_id = $1',
        [eventId],
      );
      if (eventConfig.rowCount !== 1) return 0;
      const alerts = await client.query<AlertDbRow>(
        `SELECT * FROM edge_inventory_alerts
         WHERE event_id = $1 AND state = 'OPEN' AND escalate_at IS NOT NULL AND escalate_at <= $2
         FOR UPDATE`,
        [eventId, now.toISOString()],
      );
      let count = 0;
      for (const alert of alerts.rows) {
        const responsibility = await this.responsibility(
          client,
          alert.event_id,
          alert.inventory_location_id,
          alert.sku_id,
        );
        if (!responsibility?.escalation_actor_id) continue;
        await this.enqueueNotification(
          client,
          alert,
          responsibility.escalation_actor_id,
          'escalation',
        );
        await client.query(
          `UPDATE edge_inventory_alerts
           SET escalate_at = $2::timestamptz + ($3 || ' minutes')::interval, updated_at = now()
           WHERE id = $1`,
          [alert.id, now.toISOString(), eventConfig.rows[0]!.escalation_minutes],
        );
        count += 1;
      }
      return count;
    });
  }

  async list(eventId: string): Promise<InventoryAlertRow[]> {
    const rows = await this.database.query<AlertDbRow>(
      `SELECT * FROM edge_inventory_alerts
       WHERE event_id = $1
       ORDER BY CASE severity WHEN 'CRITICAL' THEN 1 WHEN 'URGENT' THEN 2 ELSE 3 END,
                CASE state WHEN 'OPEN' THEN 1 WHEN 'ACKNOWLEDGED' THEN 2 WHEN 'ASSIGNED' THEN 3 ELSE 4 END,
                opened_at DESC`,
      [eventId],
    );
    return rows.map((row) => this.map(row));
  }

  private async evaluateLocation(
    config: AlertConfigRow,
    eventConfig: EventConfigRow,
    now: Date,
  ): Promise<void> {
    const locationId = config.inventory_location_id!;
    const onHand = await this.quantity(
      `SELECT COALESCE(SUM(quantity_delta), 0)::text AS quantity
       FROM edge_inventory_ledger WHERE event_id = $1 AND inventory_location_id = $2 AND sku_id = $3`,
      [config.event_id, locationId, config.sku_id],
    );
    const inbound = await this.quantity(
      `SELECT COALESCE(SUM(l.dispatched_quantity - l.received_quantity), 0)::text AS quantity
       FROM edge_stock_transfers t JOIN edge_stock_transfer_lines l ON l.transfer_id = t.id
       WHERE t.event_id = $1 AND t.destination_location_id = $2 AND l.sku_id = $3 AND t.state = 'IN_TRANSIT'`,
      [config.event_id, locationId, config.sku_id],
    );
    const velocity = await this.velocity(
      config.event_id,
      locationId,
      config.sku_id,
      eventConfig,
      now,
    );
    const remainingMinutes = Math.max(
      0,
      (eventConfig.event_end_at.getTime() - now.getTime()) / 60_000,
    );
    const risk = evaluateStockRisk({
      availableBase: onHand,
      absoluteMinimumBase: BigInt(config.absolute_minimum),
      velocityPerMinute: velocity,
      minutesCoverThreshold: Number(config.minutes_cover_threshold),
      eventMinutesRemaining: remainingMinutes,
    });

    let localType: 'LOW_STOCK' | 'STOCKOUT_RISK' | 'CRITICAL_STOCKOUT_RISK' | null = null;
    let severity: 'LOW' | 'URGENT' | 'CRITICAL' = 'LOW';
    if (
      onHand <= 0n ||
      (risk.minutesOfCover !== null &&
        risk.minutesOfCover <= Math.max(5, Number(config.minutes_cover_threshold) / 2))
    ) {
      localType = 'CRITICAL_STOCKOUT_RISK';
      severity = 'CRITICAL';
    } else if (risk.belowCoverThreshold || risk.projectedStockoutBeforeEventEnd) {
      localType = 'STOCKOUT_RISK';
      severity = 'URGENT';
    } else if (risk.belowAbsoluteMinimum) {
      localType = 'LOW_STOCK';
      severity = 'LOW';
    }

    const source = await this.bestSource(config.event_id, locationId, config.sku_id);
    const suggested = source
      ? recommendedTransferQuantity({
          destinationAvailableBase: onHand,
          destinationInboundBase: inbound,
          sourceAvailableBase: BigInt(source.available),
          sourceSafetyStockBase: BigInt(source.safety_stock),
          velocityPerMinute: velocity,
          targetCoverMinutes: Number(config.target_cover_minutes),
        })
      : 0n;

    const localTypes = ['LOW_STOCK', 'STOCKOUT_RISK', 'CRITICAL_STOCKOUT_RISK'];
    if (localType) {
      await this.upsertAlert({
        dedupeKey: `${localType}:${config.event_id}:${locationId}:${config.sku_id}`,
        type: localType,
        severity,
        eventId: config.event_id,
        inventoryLocationId: locationId,
        skuId: config.sku_id,
        category: config.category,
        available: onHand,
        cover: risk.minutesOfCover,
        sourceLocationId: suggested > 0n ? (source?.inventory_location_id ?? null) : null,
        suggestedQuantity: suggested,
        eventConfig,
        now,
        details: {
          inboundBase: inbound.toString(),
          velocityPerMinute: velocity,
          eventMinutesRemaining: remainingMinutes,
        },
      });
      await this.resolveOtherLocalRisk(
        config.event_id,
        locationId,
        config.sku_id,
        localTypes.filter((type) => type !== localType),
        now,
      );
    } else {
      await this.resolveOtherLocalRisk(config.event_id, locationId, config.sku_id, localTypes, now);
    }

    if (localType && suggested > 0n) {
      await this.upsertAlert({
        dedupeKey: `STOCK_IMBALANCE:${config.event_id}:${locationId}:${config.sku_id}`,
        type: 'STOCK_IMBALANCE',
        severity: 'URGENT',
        eventId: config.event_id,
        inventoryLocationId: locationId,
        skuId: config.sku_id,
        category: config.category,
        available: onHand,
        cover: risk.minutesOfCover,
        sourceLocationId: source?.inventory_location_id ?? null,
        suggestedQuantity: suggested,
        eventConfig,
        now,
        details: { inboundBase: inbound.toString(), sourceAvailableBase: source?.available ?? '0' },
      });
    } else {
      await this.resolveByDedupe(
        `STOCK_IMBALANCE:${config.event_id}:${locationId}:${config.sku_id}`,
        now,
      );
    }
  }

  private async evaluateEventWide(
    config: AlertConfigRow,
    eventConfig: EventConfigRow,
    now: Date,
  ): Promise<void> {
    const onHand = await this.quantity(
      `SELECT COALESCE(SUM(quantity_delta), 0)::text AS quantity
       FROM edge_inventory_ledger WHERE event_id = $1 AND sku_id = $2`,
      [config.event_id, config.sku_id],
    );
    const inTransit = await this.quantity(
      `SELECT COALESCE(SUM(l.dispatched_quantity - l.received_quantity), 0)::text AS quantity
       FROM edge_stock_transfers t JOIN edge_stock_transfer_lines l ON l.transfer_id = t.id
       WHERE t.event_id = $1 AND l.sku_id = $2 AND t.state = 'IN_TRANSIT'`,
      [config.event_id, config.sku_id],
    );
    const velocity = await this.velocity(config.event_id, null, config.sku_id, eventConfig, now);
    const remainingMinutes = Math.max(
      0,
      (eventConfig.event_end_at.getTime() - now.getTime()) / 60_000,
    );
    const effective = onHand + inTransit;
    const cover = minutesOfCover(effective, velocity);
    const projectedDemand = BigInt(Math.ceil(velocity * remainingMinutes));
    const safety = BigInt(config.event_wide_safety_stock);
    const shortage = effective - safety < projectedDemand;
    const dedupe = `EVENT_WIDE_STOCKOUT_RISK:${config.event_id}:${config.sku_id}`;
    if (shortage) {
      await this.upsertAlert({
        dedupeKey: dedupe,
        type: 'EVENT_WIDE_STOCKOUT_RISK',
        severity: 'CRITICAL',
        eventId: config.event_id,
        inventoryLocationId: null,
        skuId: config.sku_id,
        category: config.category,
        available: effective,
        cover,
        sourceLocationId: null,
        suggestedQuantity: 0n,
        eventConfig,
        now,
        details: {
          onHandBase: onHand.toString(),
          inTransitBase: inTransit.toString(),
          projectedDemandBase: projectedDemand.toString(),
          safetyStockBase: safety.toString(),
          velocityPerMinute: velocity,
        },
      });
    } else {
      await this.resolveByDedupe(dedupe, now);
    }
  }

  private async velocity(
    eventId: string,
    locationId: string | null,
    skuId: string,
    config: EventConfigRow,
    now: Date,
  ): Promise<number> {
    const values: unknown[] = [eventId, skuId, now.toISOString(), config.medium_window_minutes];
    const locationClause = locationId ? 'AND inventory_location_id = $5' : '';
    if (locationId) values.push(locationId);
    const rows = await this.database.query<ConsumptionRow>(
      `SELECT (-quantity_delta)::text AS quantity, occurred_at
       FROM edge_inventory_ledger
       WHERE event_id = $1 AND sku_id = $2
         AND movement_type IN ('SALE', 'RECIPE_CONSUMPTION')
         AND occurred_at > $3::timestamptz - ($4 || ' minutes')::interval
         AND occurred_at <= $3 ${locationClause}`,
      values,
    );
    return blendedVelocityPerMinute(
      rows.map((row) => ({
        occurredAtEpochMs: row.occurred_at.getTime(),
        quantityBase: BigInt(row.quantity),
      })),
      now.getTime(),
      {
        shortWindowMinutes: config.short_window_minutes,
        mediumWindowMinutes: config.medium_window_minutes,
        shortWeightBasisPoints: config.short_weight_basis_points,
      },
    );
  }

  private async bestSource(
    eventId: string,
    destinationId: string,
    skuId: string,
  ): Promise<SourceRow | null> {
    const rows = await this.database.query<SourceRow>(
      `SELECT p.inventory_location_id,
              p.on_hand::text AS available,
              COALESCE(c.source_safety_stock, 0)::text AS safety_stock
       FROM edge_inventory_stock_projection p
       LEFT JOIN edge_inventory_alert_config c
         ON c.event_id = p.event_id AND c.inventory_location_id = p.inventory_location_id AND c.sku_id = p.sku_id
       WHERE p.event_id = $1 AND p.sku_id = $2 AND p.inventory_location_id <> $3
         AND p.on_hand > COALESCE(c.source_safety_stock, 0)
       ORDER BY (p.on_hand - COALESCE(c.source_safety_stock, 0)) DESC
       LIMIT 1`,
      [eventId, skuId, destinationId],
    );
    return rows[0] ?? null;
  }

  private async upsertAlert(input: {
    dedupeKey: string;
    type: string;
    severity: 'LOW' | 'URGENT' | 'CRITICAL';
    eventId: string;
    inventoryLocationId: string | null;
    skuId: string;
    category: string | null;
    available: bigint;
    cover: number | null;
    sourceLocationId: string | null;
    suggestedQuantity: bigint;
    eventConfig: EventConfigRow;
    now: Date;
    details: Record<string, unknown>;
  }): Promise<void> {
    await this.database.transaction(async (client) => {
      const existing = await client.query<AlertDbRow>(
        `SELECT * FROM edge_inventory_alerts
         WHERE dedupe_key = $1 AND state <> 'RESOLVED' FOR UPDATE`,
        [input.dedupeKey],
      );
      const responsibility = await this.responsibility(
        client,
        input.eventId,
        input.inventoryLocationId,
        input.skuId,
      );
      if (existing.rowCount === 1) {
        await client.query(
          `UPDATE edge_inventory_alerts SET severity = $2, available_quantity = $3,
             minutes_of_cover = $4, suggested_source_location_id = $5,
             suggested_transfer_quantity = $6, responsible_actor_id = $7,
             details = $8::jsonb, updated_at = now()
           WHERE id = $1`,
          [
            existing.rows[0]!.id,
            input.severity,
            input.available.toString(),
            input.cover,
            input.sourceLocationId,
            input.suggestedQuantity.toString(),
            responsibility?.responsible_actor_id ?? null,
            JSON.stringify(input.details),
          ],
        );
        return;
      }
      const id = randomUUID();
      await client.query(
        `INSERT INTO edge_inventory_alerts(
           id, dedupe_key, alert_type, severity, state, event_id, inventory_location_id,
           sku_id, available_quantity, minutes_of_cover, suggested_source_location_id,
           suggested_transfer_quantity, responsible_actor_id, opened_at, escalate_at, details
         ) VALUES ($1,$2,$3,$4,'OPEN',$5,$6,$7,$8,$9,$10,$11,$12,$13,
                   $13::timestamptz + ($14 || ' minutes')::interval,$15::jsonb)`,
        [
          id,
          input.dedupeKey,
          input.type,
          input.severity,
          input.eventId,
          input.inventoryLocationId,
          input.skuId,
          input.available.toString(),
          input.cover,
          input.sourceLocationId,
          input.suggestedQuantity.toString(),
          responsibility?.responsible_actor_id ?? null,
          input.now.toISOString(),
          input.eventConfig.escalation_minutes,
          JSON.stringify(input.details),
        ],
      );
      await this.history(
        client,
        id,
        null,
        'OPEN',
        null,
        'inventory risk detected',
        input.now.toISOString(),
      );
      const alert = await this.alert(client, id, false);
      if (responsibility?.responsible_actor_id) {
        await this.enqueueNotification(
          client,
          alert,
          responsibility.responsible_actor_id,
          'opened',
        );
      }
      await this.queueCloud(client, alert);
    });
  }

  private async resolveOtherLocalRisk(
    eventId: string,
    locationId: string,
    skuId: string,
    types: string[],
    now: Date,
  ): Promise<void> {
    for (const type of types)
      await this.resolveByDedupe(`${type}:${eventId}:${locationId}:${skuId}`, now);
  }

  private async resolveByDedupe(dedupeKey: string, now: Date): Promise<void> {
    await this.database.transaction(async (client) => {
      const rows = await client.query<AlertDbRow>(
        `SELECT * FROM edge_inventory_alerts WHERE dedupe_key = $1 AND state <> 'RESOLVED' FOR UPDATE`,
        [dedupeKey],
      );
      if (rows.rowCount !== 1) return;
      const alert = rows.rows[0]!;
      await client.query(
        `UPDATE edge_inventory_alerts SET state = 'RESOLVED', resolved_at = $2, updated_at = now() WHERE id = $1`,
        [alert.id, now.toISOString()],
      );
      await this.history(
        client,
        alert.id,
        alert.state,
        'RESOLVED',
        null,
        'inventory risk cleared',
        now.toISOString(),
      );
      await this.queueCloud(client, await this.alert(client, alert.id, false));
    });
  }

  private async responsibility(
    client: PoolClient,
    eventId: string,
    locationId: string | null,
    skuId: string,
  ): Promise<ResponsibilityRow | null> {
    const rows = await client.query<ResponsibilityRow>(
      `SELECT r.responsible_actor_id, r.escalation_actor_id
       FROM edge_inventory_responsibilities r
       JOIN edge_inventory_skus s ON s.event_id = r.event_id AND s.sku_id = $3
       WHERE r.event_id = $1
         AND (r.inventory_location_id IS NULL OR r.inventory_location_id = $2)
         AND (r.category IS NULL OR r.category = s.category)
       ORDER BY (r.inventory_location_id IS NOT NULL) DESC,
                (r.category IS NOT NULL) DESC,
                r.priority ASC
       LIMIT 1`,
      [eventId, locationId, skuId],
    );
    return rows.rows[0] ?? null;
  }

  private async enqueueNotification(
    client: PoolClient,
    alert: AlertDbRow,
    recipient: string,
    reason: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO edge_inventory_notification_outbox(id, alert_id, channel, recipient_actor_id, payload)
       VALUES ($1,$2,'IN_APP',$3,$4::jsonb)`,
      [
        randomUUID(),
        alert.id,
        recipient,
        JSON.stringify({
          alertId: alert.id,
          type: alert.alert_type,
          severity: alert.severity,
          reason,
        }),
      ],
    );
  }

  private async history(
    client: PoolClient,
    alertId: string,
    from: string | null,
    to: string,
    actorId: string | null,
    reason: string | undefined,
    occurredAt: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO edge_inventory_alert_history(id, alert_id, from_state, to_state, actor_id, reason, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [randomUUID(), alertId, from, to, actorId, reason ?? null, occurredAt],
    );
  }

  private async queueCloud(client: PoolClient, alert: AlertDbRow): Promise<void> {
    await client.query(
      `INSERT INTO edge_inventory_cloud_outbox(id, event_type, aggregate_type, aggregate_id, payload)
       VALUES ($1,'INVENTORY_ALERT_UPSERTED','INVENTORY_ALERT',$2,$3::jsonb)`,
      [randomUUID(), alert.id, JSON.stringify(this.map(alert))],
    );
  }

  private async alert(client: PoolClient, id: string, lock: boolean): Promise<AlertDbRow> {
    const result = await client.query<AlertDbRow>(
      `SELECT * FROM edge_inventory_alerts WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
      [id],
    );
    if (result.rowCount !== 1) throw new NotFoundException('inventory alert not found');
    return result.rows[0]!;
  }

  private async quantity(sql: string, values: readonly unknown[]): Promise<bigint> {
    const rows = await this.database.query<QuantityRow>(sql, values);
    return BigInt(rows[0]!.quantity);
  }

  private map(row: AlertDbRow): InventoryAlertRow {
    return {
      id: row.id,
      alertType: row.alert_type,
      severity: row.severity,
      state: row.state,
      eventId: row.event_id,
      inventoryLocationId: row.inventory_location_id,
      skuId: row.sku_id,
      availableQuantityBase: row.available_quantity,
      minutesOfCover: row.minutes_of_cover === null ? null : Number(row.minutes_of_cover),
      suggestedSourceLocationId: row.suggested_source_location_id,
      suggestedTransferQuantityBase: row.suggested_transfer_quantity,
      responsibleActorId: row.responsible_actor_id,
      assignedActorId: row.assigned_actor_id,
      openedAt: row.opened_at.toISOString(),
      escalateAt: row.escalate_at?.toISOString() ?? null,
    };
  }
}
