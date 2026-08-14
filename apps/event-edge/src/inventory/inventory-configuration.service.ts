import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EdgeDatabaseService } from '../database/database.service';
import type { InventoryConfigurationSnapshot } from './inventory.types';

@Injectable()
export class InventoryConfigurationService {
  constructor(private readonly database: EdgeDatabaseService) {}

  async install(snapshot: InventoryConfigurationSnapshot): Promise<void> {
    await this.database.transaction(async (client) => {
      const shortWindow = snapshot.shortWindowMinutes ?? 10;
      const mediumWindow = snapshot.mediumWindowMinutes ?? 30;
      const shortWeight = snapshot.shortWeightBasisPoints ?? 6000;
      const escalation = snapshot.escalationMinutes ?? 5;
      if (mediumWindow < shortWindow) throw new Error('medium inventory window must not be shorter than short window');
      if (shortWeight < 0 || shortWeight > 10_000) throw new Error('short inventory weight must be between 0 and 10000 basis points');

      await client.query(
        `INSERT INTO edge_inventory_event_config(
           event_id, event_end_at, short_window_minutes, medium_window_minutes,
           short_weight_basis_points, escalation_minutes
         ) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (event_id) DO UPDATE SET
           event_end_at = EXCLUDED.event_end_at,
           short_window_minutes = EXCLUDED.short_window_minutes,
           medium_window_minutes = EXCLUDED.medium_window_minutes,
           short_weight_basis_points = EXCLUDED.short_weight_basis_points,
           escalation_minutes = EXCLUDED.escalation_minutes,
           updated_at = now()`,
        [snapshot.eventId, snapshot.eventEndAt, shortWindow, mediumWindow, shortWeight, escalation],
      );

      for (const location of snapshot.locations) {
        await client.query(
          `INSERT INTO edge_inventory_locations(event_id, id, name, type)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (event_id, id) DO UPDATE SET
             name = EXCLUDED.name, type = EXCLUDED.type, lifecycle = 'ACTIVE', updated_at = now()`,
          [snapshot.eventId, location.id, location.name, location.type],
        );
      }
      for (const sku of snapshot.skus) {
        await client.query(
          `INSERT INTO edge_inventory_skus(event_id, sku_id, name, category, base_unit)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (event_id, sku_id) DO UPDATE SET
             name = EXCLUDED.name, category = EXCLUDED.category,
             base_unit = EXCLUDED.base_unit, updated_at = now()`,
          [snapshot.eventId, sku.skuId, sku.name, sku.category ?? null, sku.baseUnit],
        );
      }

      await client.query('DELETE FROM edge_sales_inventory_mapping WHERE event_id = $1', [snapshot.eventId]);
      for (const mapping of snapshot.salesMappings) {
        await client.query(
          `INSERT INTO edge_sales_inventory_mapping(event_id, sales_location_id, inventory_location_id)
           VALUES ($1,$2,$3)`,
          [snapshot.eventId, mapping.salesLocationId, mapping.inventoryLocationId],
        );
      }

      await client.query('DELETE FROM edge_inventory_recipes WHERE event_id = $1', [snapshot.eventId]);
      for (const recipe of snapshot.recipes) {
        await client.query(
          `INSERT INTO edge_inventory_recipes(event_id, sold_sku_id, component_sku_id, quantity_per_sold_unit)
           VALUES ($1,$2,$3,$4)`,
          [snapshot.eventId, recipe.soldSkuId, recipe.componentSkuId, recipe.quantityPerSoldUnit],
        );
      }

      await client.query('DELETE FROM edge_inventory_alert_config WHERE event_id = $1', [snapshot.eventId]);
      for (const config of snapshot.alertConfigs) {
        await client.query(
          `INSERT INTO edge_inventory_alert_config(
             id, event_id, inventory_location_id, sku_id, absolute_minimum,
             minutes_cover_threshold, target_cover_minutes, source_safety_stock,
             event_wide_safety_stock, imbalance_ratio
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            config.id,
            snapshot.eventId,
            config.inventoryLocationId ?? null,
            config.skuId,
            config.absoluteMinimum,
            config.minutesCoverThreshold,
            config.targetCoverMinutes,
            config.sourceSafetyStock,
            config.eventWideSafetyStock,
            config.imbalanceRatio ?? 2,
          ],
        );
      }

      await client.query('DELETE FROM edge_inventory_responsibilities WHERE event_id = $1', [snapshot.eventId]);
      for (const responsibility of snapshot.responsibilities) {
        await client.query(
          `INSERT INTO edge_inventory_responsibilities(
             id, event_id, inventory_location_id, category, responsible_actor_id,
             escalation_actor_id, priority
           ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            responsibility.id,
            snapshot.eventId,
            responsibility.inventoryLocationId ?? null,
            responsibility.category ?? null,
            responsibility.responsibleActorId,
            responsibility.escalationActorId ?? null,
            responsibility.priority ?? 100,
          ],
        );
      }

      await client.query('DELETE FROM edge_inventory_actor_permissions WHERE event_id = $1', [snapshot.eventId]);
      for (const permission of snapshot.permissions) {
        await client.query(
          `INSERT INTO edge_inventory_actor_permissions(event_id, actor_id, permission)
           VALUES ($1,$2,$3)`,
          [snapshot.eventId, permission.actorId, permission.permission],
        );
      }

      await client.query(
        `INSERT INTO edge_inventory_cloud_outbox(id, event_type, aggregate_type, aggregate_id, payload)
         VALUES ($1,'INVENTORY_CONFIGURATION_INSTALLED','INVENTORY_EVENT',$2,$3::jsonb)`,
        [
          randomUUID(),
          snapshot.eventId,
          JSON.stringify({
            eventId: snapshot.eventId,
            eventEndAt: snapshot.eventEndAt,
            sourceActorId: snapshot.sourceActorId,
            locationCount: snapshot.locations.length,
            skuCount: snapshot.skus.length,
            recipeCount: snapshot.recipes.length,
          }),
        ],
      );
    });
  }
}
