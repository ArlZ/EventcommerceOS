import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import type {
  EventConfigurationView,
  EventRecord,
  InventoryLocationRecord,
  MenuAssignmentRecord,
  MenuItemPriceRecord,
  MenuItemRecord,
  MenuRecord,
  OrganisationRecord,
  ProductRecord,
  SalesLocationRecord,
  SkuRecord,
} from '@event-commerce/contracts';
import { DatabaseService } from '../database/database.service';
import { assertOrganisationAccess, type AdminContext } from './admin-context';

type Row = QueryResultRow & Record<string, unknown>;

function uniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

function lifecycleArchive(lifecycle: string): Date | null {
  return lifecycle === 'ARCHIVED' ? new Date() : null;
}

@Injectable()
export class ConfigurationService {
  constructor(private readonly database: DatabaseService) {}

  private async audit(
    client: PoolClient,
    context: AdminContext,
    organisationId: string,
    action: string,
    entityType: string,
    entityId: string,
    changes: Record<string, unknown>,
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_events
       (id, organisation_id, actor_id, action, entity_type, entity_id, changes)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        randomUUID(),
        organisationId,
        context.actorId,
        action,
        entityType,
        entityId,
        JSON.stringify(changes),
      ],
    );
  }

  private async organisationExists(client: PoolClient, organisationId: string): Promise<void> {
    const result = await client.query('SELECT id FROM organisations WHERE id = $1', [
      organisationId,
    ]);
    if (result.rowCount === 0) throw new NotFoundException('Organisation not found');
  }

  private async eventRow(client: PoolClient, eventId: string): Promise<Row> {
    const result = await client.query<Row>(
      'SELECT id, organisation_id, lifecycle FROM events WHERE id = $1',
      [eventId],
    );
    if (result.rowCount === 0) throw new NotFoundException('Event not found');
    return result.rows[0]!;
  }

  private async productRow(client: PoolClient, productId: string): Promise<Row> {
    const result = await client.query<Row>(
      'SELECT id, organisation_id FROM products WHERE id = $1',
      [productId],
    );
    if (result.rowCount === 0) throw new NotFoundException('Product not found');
    return result.rows[0]!;
  }

  private async skuRow(client: PoolClient, skuId: string): Promise<Row> {
    const result = await client.query<Row>('SELECT id, organisation_id FROM skus WHERE id = $1', [
      skuId,
    ]);
    if (result.rowCount === 0) throw new NotFoundException('SKU not found');
    return result.rows[0]!;
  }

  private async menuRow(client: PoolClient, menuId: string): Promise<Row> {
    const result = await client.query<Row>(
      'SELECT id, organisation_id, event_id FROM menus WHERE id = $1',
      [menuId],
    );
    if (result.rowCount === 0) throw new NotFoundException('Menu not found');
    return result.rows[0]!;
  }

  private async salesLocationRow(client: PoolClient, salesLocationId: string): Promise<Row> {
    const result = await client.query<Row>(
      'SELECT id, organisation_id, event_id FROM sales_locations WHERE id = $1',
      [salesLocationId],
    );
    if (result.rowCount === 0) throw new NotFoundException('Sales location not found');
    return result.rows[0]!;
  }

  private async menuItemRow(client: PoolClient, menuItemId: string): Promise<Row> {
    const result = await client.query<Row>(
      `SELECT mi.id, mi.organisation_id, mi.menu_id, m.event_id
       FROM menu_items mi
       JOIN menus m ON m.id = mi.menu_id
       WHERE mi.id = $1`,
      [menuItemId],
    );
    if (result.rowCount === 0) throw new NotFoundException('Menu item not found');
    return result.rows[0]!;
  }

  async createOrganisation(context: AdminContext, name: string): Promise<OrganisationRecord> {
    return this.database.transaction(async (client) => {
      const id = randomUUID();
      const result = await client.query<OrganisationRecord & QueryResultRow>(
        `INSERT INTO organisations (id, name)
         VALUES ($1, $2)
         RETURNING id, name, lifecycle, archived_at AS "archivedAt",
                   created_at AS "createdAt", updated_at AS "updatedAt"`,
        [id, name],
      );
      await this.audit(client, context, id, 'ORGANISATION_CREATED', 'Organisation', id, { name });
      return result.rows[0]!;
    });
  }

  async getOrganisation(
    context: AdminContext,
    organisationId: string,
  ): Promise<OrganisationRecord> {
    assertOrganisationAccess(context, organisationId);
    const rows = await this.database.query<OrganisationRecord>(
      `SELECT id, name, lifecycle, archived_at AS "archivedAt",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM organisations WHERE id = $1`,
      [organisationId],
    );
    if (!rows[0]) throw new NotFoundException('Organisation not found');
    return rows[0];
  }

  async updateOrganisation(
    context: AdminContext,
    organisationId: string,
    patch: { name?: string; lifecycle?: 'ACTIVE' | 'ARCHIVED' },
  ): Promise<OrganisationRecord> {
    assertOrganisationAccess(context, organisationId);
    if (patch.name === undefined && patch.lifecycle === undefined) {
      throw new BadRequestException('At least one organisation field must be supplied');
    }
    return this.database.transaction(async (client) => {
      await this.organisationExists(client, organisationId);
      const current = await client.query<Row>(
        'SELECT name, lifecycle FROM organisations WHERE id = $1',
        [organisationId],
      );
      const nextName = patch.name ?? String(current.rows[0]!.name);
      const nextLifecycle = patch.lifecycle ?? String(current.rows[0]!.lifecycle);
      const result = await client.query<OrganisationRecord & QueryResultRow>(
        `UPDATE organisations
         SET name = $2, lifecycle = $3, archived_at = $4, updated_at = now()
         WHERE id = $1
         RETURNING id, name, lifecycle, archived_at AS "archivedAt",
                   created_at AS "createdAt", updated_at AS "updatedAt"`,
        [organisationId, nextName, nextLifecycle, lifecycleArchive(nextLifecycle)],
      );
      await this.audit(
        client,
        context,
        organisationId,
        'ORGANISATION_UPDATED',
        'Organisation',
        organisationId,
        patch,
      );
      return result.rows[0]!;
    });
  }

  async createEvent(
    context: AdminContext,
    input: {
      organisationId: string;
      name: string;
      timezone: string;
      startsAt: string;
      endsAt: string;
    },
  ): Promise<EventRecord> {
    assertOrganisationAccess(context, input.organisationId);
    if (new Date(input.endsAt).getTime() <= new Date(input.startsAt).getTime()) {
      throw new BadRequestException('endsAt must be after startsAt');
    }
    return this.database.transaction(async (client) => {
      await this.organisationExists(client, input.organisationId);
      const id = randomUUID();
      const result = await client.query<EventRecord & QueryResultRow>(
        `INSERT INTO events
         (id, organisation_id, name, timezone, starts_at, ends_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, organisation_id AS "organisationId", name, timezone, lifecycle,
                   starts_at AS "startsAt", ends_at AS "endsAt", archived_at AS "archivedAt",
                   created_at AS "createdAt", updated_at AS "updatedAt"`,
        [id, input.organisationId, input.name, input.timezone, input.startsAt, input.endsAt],
      );
      await this.audit(client, context, input.organisationId, 'EVENT_CREATED', 'Event', id, input);
      return result.rows[0]!;
    });
  }

  private async assertPosMenuActivationReady(
    client: PoolClient,
    eventId: string,
    organisationId: string,
  ): Promise<void> {
    const result = await client.query<{ sales_location_id: string }>(
      `SELECT location.id::text AS sales_location_id
       FROM sales_locations location
       LEFT JOIN LATERAL (
         SELECT publication.id
         FROM pos_menu_publications publication
         WHERE publication.event_id=$1
           AND publication.organisation_id=$2
           AND publication.sales_location_id=location.id
         ORDER BY publication.version DESC
         LIMIT 1
       ) latest ON true
       LEFT JOIN LATERAL (
         SELECT receipt.id
         FROM pos_menu_install_receipts receipt
         WHERE receipt.publication_id=latest.id
           AND receipt.organisation_id=$2
         ORDER BY receipt.reported_at,receipt.id
         LIMIT 1
       ) installed ON true
       WHERE location.event_id=$1
         AND location.organisation_id=$2
         AND location.lifecycle='ACTIVE'
         AND (latest.id IS NULL OR installed.id IS NULL)
       ORDER BY location.id
       LIMIT 1`,
      [eventId, organisationId],
    );
    if (result.rowCount !== 0) {
      throw new ConflictException(
        'Event cannot become ACTIVE until the latest POS menu for every active sales location is installed on Event Edge',
      );
    }
  }

  async updateEvent(
    context: AdminContext,
    eventId: string,
    patch: Partial<{
      name: string;
      timezone: string;
      startsAt: string;
      endsAt: string;
      lifecycle: 'DRAFT' | 'ACTIVE' | 'CLOSED' | 'ARCHIVED';
    }>,
  ): Promise<EventRecord> {
    if (Object.keys(patch).length === 0)
      throw new BadRequestException('At least one event field must be supplied');
    return this.database.transaction(async (client) => {
      const event = await this.eventRow(client, eventId);
      const organisationId = String(event.organisation_id);
      assertOrganisationAccess(context, organisationId);
      const current = await client.query<Row>('SELECT * FROM events WHERE id = $1', [eventId]);
      const row = current.rows[0]!;
      const startsAt = patch.startsAt ?? new Date(row.starts_at as string | Date).toISOString();
      const endsAt = patch.endsAt ?? new Date(row.ends_at as string | Date).toISOString();
      if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
        throw new BadRequestException('endsAt must be after startsAt');
      }
      const lifecycle = patch.lifecycle ?? String(row.lifecycle);
      if (lifecycle === 'ACTIVE' && String(row.lifecycle) !== 'ACTIVE') {
        await this.assertPosMenuActivationReady(client, eventId, organisationId);
      }
      const result = await client.query<EventRecord & QueryResultRow>(
        `UPDATE events
         SET name = $2, timezone = $3, starts_at = $4, ends_at = $5,
             lifecycle = $6, archived_at = $7, updated_at = now()
         WHERE id = $1
         RETURNING id, organisation_id AS "organisationId", name, timezone, lifecycle,
                   starts_at AS "startsAt", ends_at AS "endsAt", archived_at AS "archivedAt",
                   created_at AS "createdAt", updated_at AS "updatedAt"`,
        [
          eventId,
          patch.name ?? row.name,
          patch.timezone ?? row.timezone,
          startsAt,
          endsAt,
          lifecycle,
          lifecycleArchive(lifecycle),
        ],
      );
      await this.audit(client, context, organisationId, 'EVENT_UPDATED', 'Event', eventId, patch);
      return result.rows[0]!;
    });
  }

  async createSalesLocation(
    context: AdminContext,
    eventId: string,
    input: { name: string; type: string },
  ): Promise<SalesLocationRecord> {
    return this.database.transaction(async (client) => {
      const event = await this.eventRow(client, eventId);
      const organisationId = String(event.organisation_id);
      assertOrganisationAccess(context, organisationId);
      const id = randomUUID();
      const result = await client.query<SalesLocationRecord & QueryResultRow>(
        `INSERT INTO sales_locations (id, organisation_id, event_id, name, type)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, organisation_id AS "organisationId", event_id AS "eventId",
                   name, type, lifecycle, archived_at AS "archivedAt",
                   created_at AS "createdAt", updated_at AS "updatedAt"`,
        [id, organisationId, eventId, input.name, input.type],
      );
      await this.audit(
        client,
        context,
        organisationId,
        'SALES_LOCATION_CREATED',
        'SalesLocation',
        id,
        input,
      );
      return result.rows[0]!;
    });
  }

  async updateSalesLocation(
    context: AdminContext,
    id: string,
    patch: Partial<{ name: string; type: string; lifecycle: 'ACTIVE' | 'ARCHIVED' }>,
  ): Promise<SalesLocationRecord> {
    if (Object.keys(patch).length === 0)
      throw new BadRequestException('At least one sales location field must be supplied');
    return this.database.transaction(async (client) => {
      const current = await client.query<Row>('SELECT * FROM sales_locations WHERE id = $1', [id]);
      if (current.rowCount === 0) throw new NotFoundException('Sales location not found');
      const row = current.rows[0]!;
      const organisationId = String(row.organisation_id);
      assertOrganisationAccess(context, organisationId);
      const lifecycle = patch.lifecycle ?? String(row.lifecycle);
      const result = await client.query<SalesLocationRecord & QueryResultRow>(
        `UPDATE sales_locations
         SET name = $2, type = $3, lifecycle = $4, archived_at = $5, updated_at = now()
         WHERE id = $1
         RETURNING id, organisation_id AS "organisationId", event_id AS "eventId",
                   name, type, lifecycle, archived_at AS "archivedAt",
                   created_at AS "createdAt", updated_at AS "updatedAt"`,
        [
          id,
          patch.name ?? row.name,
          patch.type ?? row.type,
          lifecycle,
          lifecycleArchive(lifecycle),
        ],
      );
      await this.audit(
        client,
        context,
        organisationId,
        'SALES_LOCATION_UPDATED',
        'SalesLocation',
        id,
        patch,
      );
      return result.rows[0]!;
    });
  }

  async createInventoryLocation(
    context: AdminContext,
    eventId: string,
    input: { name: string; type: string },
  ): Promise<InventoryLocationRecord> {
    return this.database.transaction(async (client) => {
      const event = await this.eventRow(client, eventId);
      const organisationId = String(event.organisation_id);
      assertOrganisationAccess(context, organisationId);
      const id = randomUUID();
      const result = await client.query<InventoryLocationRecord & QueryResultRow>(
        `INSERT INTO inventory_locations (id, organisation_id, event_id, name, type)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, organisation_id AS "organisationId", event_id AS "eventId",
                   name, type, lifecycle, archived_at AS "archivedAt",
                   created_at AS "createdAt", updated_at AS "updatedAt"`,
        [id, organisationId, eventId, input.name, input.type],
      );
      await this.audit(
        client,
        context,
        organisationId,
        'INVENTORY_LOCATION_CREATED',
        'InventoryLocation',
        id,
        input,
      );
      return result.rows[0]!;
    });
  }

  async updateInventoryLocation(
    context: AdminContext,
    id: string,
    patch: Partial<{ name: string; type: string; lifecycle: 'ACTIVE' | 'ARCHIVED' }>,
  ): Promise<InventoryLocationRecord> {
    if (Object.keys(patch).length === 0)
      throw new BadRequestException('At least one inventory location field must be supplied');
    return this.database.transaction(async (client) => {
      const current = await client.query<Row>('SELECT * FROM inventory_locations WHERE id = $1', [
        id,
      ]);
      if (current.rowCount === 0) throw new NotFoundException('Inventory location not found');
      const row = current.rows[0]!;
      const organisationId = String(row.organisation_id);
      assertOrganisationAccess(context, organisationId);
      const lifecycle = patch.lifecycle ?? String(row.lifecycle);
      const result = await client.query<InventoryLocationRecord & QueryResultRow>(
        `UPDATE inventory_locations
         SET name = $2, type = $3, lifecycle = $4, archived_at = $5, updated_at = now()
         WHERE id = $1
         RETURNING id, organisation_id AS "organisationId", event_id AS "eventId",
                   name, type, lifecycle, archived_at AS "archivedAt",
                   created_at AS "createdAt", updated_at AS "updatedAt"`,
        [
          id,
          patch.name ?? row.name,
          patch.type ?? row.type,
          lifecycle,
          lifecycleArchive(lifecycle),
        ],
      );
      await this.audit(
        client,
        context,
        organisationId,
        'INVENTORY_LOCATION_UPDATED',
        'InventoryLocation',
        id,
        patch,
      );
      return result.rows[0]!;
    });
  }

  async createProduct(
    context: AdminContext,
    input: { organisationId: string; name: string; category?: string },
  ): Promise<ProductRecord> {
    assertOrganisationAccess(context, input.organisationId);
    return this.database.transaction(async (client) => {
      await this.organisationExists(client, input.organisationId);
      const id = randomUUID();
      const result = await client.query<ProductRecord & QueryResultRow>(
        `INSERT INTO products (id, organisation_id, name, category)
         VALUES ($1, $2, $3, $4)
         RETURNING id, organisation_id AS "organisationId", name, category, lifecycle,
                   archived_at AS "archivedAt", created_at AS "createdAt", updated_at AS "updatedAt"`,
        [id, input.organisationId, input.name, input.category ?? null],
      );
      await this.audit(
        client,
        context,
        input.organisationId,
        'PRODUCT_CREATED',
        'Product',
        id,
        input,
      );
      return result.rows[0]!;
    });
  }

  async updateProduct(
    context: AdminContext,
    id: string,
    patch: Partial<{ name: string; category: string; lifecycle: 'ACTIVE' | 'ARCHIVED' }>,
  ): Promise<ProductRecord> {
    if (Object.keys(patch).length === 0)
      throw new BadRequestException('At least one product field must be supplied');
    return this.database.transaction(async (client) => {
      const current = await client.query<Row>('SELECT * FROM products WHERE id = $1', [id]);
      if (current.rowCount === 0) throw new NotFoundException('Product not found');
      const row = current.rows[0]!;
      const organisationId = String(row.organisation_id);
      assertOrganisationAccess(context, organisationId);
      const lifecycle = patch.lifecycle ?? String(row.lifecycle);
      const result = await client.query<ProductRecord & QueryResultRow>(
        `UPDATE products
         SET name = $2, category = $3, lifecycle = $4, archived_at = $5, updated_at = now()
         WHERE id = $1
         RETURNING id, organisation_id AS "organisationId", name, category, lifecycle,
                   archived_at AS "archivedAt", created_at AS "createdAt", updated_at AS "updatedAt"`,
        [
          id,
          patch.name ?? row.name,
          patch.category ?? row.category,
          lifecycle,
          lifecycleArchive(lifecycle),
        ],
      );
      await this.audit(client, context, organisationId, 'PRODUCT_UPDATED', 'Product', id, patch);
      return result.rows[0]!;
    });
  }

  async createSku(
    context: AdminContext,
    productId: string,
    input: { name: string; code: string; unitName: string },
  ): Promise<SkuRecord> {
    try {
      return await this.database.transaction(async (client) => {
        const product = await this.productRow(client, productId);
        const organisationId = String(product.organisation_id);
        assertOrganisationAccess(context, organisationId);
        const id = randomUUID();
        const result = await client.query<SkuRecord & QueryResultRow>(
          `INSERT INTO skus (id, organisation_id, product_id, name, code, unit_name)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, organisation_id AS "organisationId", product_id AS "productId",
                     name, code, unit_name AS "unitName", lifecycle, archived_at AS "archivedAt",
                     created_at AS "createdAt", updated_at AS "updatedAt"`,
          [id, organisationId, productId, input.name, input.code, input.unitName],
        );
        await this.audit(client, context, organisationId, 'SKU_CREATED', 'Sku', id, input);
        return result.rows[0]!;
      });
    } catch (error) {
      if (uniqueViolation(error))
        throw new ConflictException('SKU code already exists in this organisation');
      throw error;
    }
  }

  async updateSku(
    context: AdminContext,
    id: string,
    patch: Partial<{
      name: string;
      code: string;
      unitName: string;
      lifecycle: 'ACTIVE' | 'ARCHIVED';
    }>,
  ): Promise<SkuRecord> {
    if (Object.keys(patch).length === 0)
      throw new BadRequestException('At least one SKU field must be supplied');
    try {
      return await this.database.transaction(async (client) => {
        const current = await client.query<Row>('SELECT * FROM skus WHERE id = $1', [id]);
        if (current.rowCount === 0) throw new NotFoundException('SKU not found');
        const row = current.rows[0]!;
        const organisationId = String(row.organisation_id);
        assertOrganisationAccess(context, organisationId);
        const lifecycle = patch.lifecycle ?? String(row.lifecycle);
        const result = await client.query<SkuRecord & QueryResultRow>(
          `UPDATE skus
           SET name = $2, code = $3, unit_name = $4, lifecycle = $5,
               archived_at = $6, updated_at = now()
           WHERE id = $1
           RETURNING id, organisation_id AS "organisationId", product_id AS "productId",
                     name, code, unit_name AS "unitName", lifecycle, archived_at AS "archivedAt",
                     created_at AS "createdAt", updated_at AS "updatedAt"`,
          [
            id,
            patch.name ?? row.name,
            patch.code ?? row.code,
            patch.unitName ?? row.unit_name,
            lifecycle,
            lifecycleArchive(lifecycle),
          ],
        );
        await this.audit(client, context, organisationId, 'SKU_UPDATED', 'Sku', id, patch);
        return result.rows[0]!;
      });
    } catch (error) {
      if (uniqueViolation(error))
        throw new ConflictException('SKU code already exists in this organisation');
      throw error;
    }
  }

  async createMenu(context: AdminContext, eventId: string, name: string): Promise<MenuRecord> {
    return this.database.transaction(async (client) => {
      const event = await this.eventRow(client, eventId);
      const organisationId = String(event.organisation_id);
      assertOrganisationAccess(context, organisationId);
      const id = randomUUID();
      const result = await client.query<MenuRecord & QueryResultRow>(
        `INSERT INTO menus (id, organisation_id, event_id, name)
         VALUES ($1, $2, $3, $4)
         RETURNING id, organisation_id AS "organisationId", event_id AS "eventId", name,
                   lifecycle, archived_at AS "archivedAt",
                   created_at AS "createdAt", updated_at AS "updatedAt"`,
        [id, organisationId, eventId, name],
      );
      await this.audit(client, context, organisationId, 'MENU_CREATED', 'Menu', id, {
        name,
        eventId,
      });
      return result.rows[0]!;
    });
  }

  async updateMenu(
    context: AdminContext,
    id: string,
    patch: Partial<{ name: string; lifecycle: 'ACTIVE' | 'ARCHIVED' }>,
  ): Promise<MenuRecord> {
    if (Object.keys(patch).length === 0)
      throw new BadRequestException('At least one menu field must be supplied');
    return this.database.transaction(async (client) => {
      const current = await client.query<Row>('SELECT * FROM menus WHERE id = $1', [id]);
      if (current.rowCount === 0) throw new NotFoundException('Menu not found');
      const row = current.rows[0]!;
      const organisationId = String(row.organisation_id);
      assertOrganisationAccess(context, organisationId);
      const lifecycle = patch.lifecycle ?? String(row.lifecycle);
      const result = await client.query<MenuRecord & QueryResultRow>(
        `UPDATE menus
         SET name = $2, lifecycle = $3, archived_at = $4, updated_at = now()
         WHERE id = $1
         RETURNING id, organisation_id AS "organisationId", event_id AS "eventId", name,
                   lifecycle, archived_at AS "archivedAt",
                   created_at AS "createdAt", updated_at AS "updatedAt"`,
        [id, patch.name ?? row.name, lifecycle, lifecycleArchive(lifecycle)],
      );
      await this.audit(client, context, organisationId, 'MENU_UPDATED', 'Menu', id, patch);
      return result.rows[0]!;
    });
  }

  async assignMenu(
    context: AdminContext,
    menuId: string,
    salesLocationId: string,
  ): Promise<MenuAssignmentRecord> {
    try {
      return await this.database.transaction(async (client) => {
        const menu = await this.menuRow(client, menuId);
        const location = await this.salesLocationRow(client, salesLocationId);
        const organisationId = String(menu.organisation_id);
        assertOrganisationAccess(context, organisationId);
        if (String(location.organisation_id) !== organisationId)
          throw new ForbiddenException('Cross-organisation menu assignment is not allowed');
        if (String(location.event_id) !== String(menu.event_id))
          throw new BadRequestException('Menu can only be assigned inside its own event');
        const id = randomUUID();
        const result = await client.query<MenuAssignmentRecord & QueryResultRow>(
          `INSERT INTO menu_assignments (id, organisation_id, menu_id, sales_location_id)
           VALUES ($1, $2, $3, $4)
           RETURNING id, organisation_id AS "organisationId", menu_id AS "menuId",
                     sales_location_id AS "salesLocationId", created_at AS "createdAt"`,
          [id, organisationId, menuId, salesLocationId],
        );
        await this.audit(client, context, organisationId, 'MENU_ASSIGNED', 'MenuAssignment', id, {
          menuId,
          salesLocationId,
        });
        return result.rows[0]!;
      });
    } catch (error) {
      if (uniqueViolation(error))
        throw new ConflictException('Menu is already assigned to this sales location');
      throw error;
    }
  }

  async createMenuItem(
    context: AdminContext,
    menuId: string,
    input: { skuId: string; displayName: string; sortOrder: number },
  ): Promise<MenuItemRecord> {
    try {
      return await this.database.transaction(async (client) => {
        const menu = await this.menuRow(client, menuId);
        const sku = await this.skuRow(client, input.skuId);
        const organisationId = String(menu.organisation_id);
        assertOrganisationAccess(context, organisationId);
        if (String(sku.organisation_id) !== organisationId)
          throw new ForbiddenException('Cross-organisation SKU reference is not allowed');
        const id = randomUUID();
        const result = await client.query<MenuItemRecord & QueryResultRow>(
          `INSERT INTO menu_items (id, organisation_id, menu_id, sku_id, display_name, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, organisation_id AS "organisationId", menu_id AS "menuId",
                     sku_id AS "skuId", display_name AS "displayName", sort_order AS "sortOrder",
                     lifecycle, archived_at AS "archivedAt", created_at AS "createdAt", updated_at AS "updatedAt"`,
          [id, organisationId, menuId, input.skuId, input.displayName, input.sortOrder],
        );
        await this.audit(
          client,
          context,
          organisationId,
          'MENU_ITEM_CREATED',
          'MenuItem',
          id,
          input,
        );
        return result.rows[0]!;
      });
    } catch (error) {
      if (uniqueViolation(error)) throw new ConflictException('SKU already exists on this menu');
      throw error;
    }
  }

  async updateMenuItem(
    context: AdminContext,
    id: string,
    patch: Partial<{ displayName: string; sortOrder: number; lifecycle: 'ACTIVE' | 'ARCHIVED' }>,
  ): Promise<MenuItemRecord> {
    if (Object.keys(patch).length === 0)
      throw new BadRequestException('At least one menu item field must be supplied');
    return this.database.transaction(async (client) => {
      const current = await client.query<Row>('SELECT * FROM menu_items WHERE id = $1', [id]);
      if (current.rowCount === 0) throw new NotFoundException('Menu item not found');
      const row = current.rows[0]!;
      const organisationId = String(row.organisation_id);
      assertOrganisationAccess(context, organisationId);
      const lifecycle = patch.lifecycle ?? String(row.lifecycle);
      const result = await client.query<MenuItemRecord & QueryResultRow>(
        `UPDATE menu_items
         SET display_name = $2, sort_order = $3, lifecycle = $4, archived_at = $5, updated_at = now()
         WHERE id = $1
         RETURNING id, organisation_id AS "organisationId", menu_id AS "menuId", sku_id AS "skuId",
                   display_name AS "displayName", sort_order AS "sortOrder", lifecycle,
                   archived_at AS "archivedAt", created_at AS "createdAt", updated_at AS "updatedAt"`,
        [
          id,
          patch.displayName ?? row.display_name,
          patch.sortOrder ?? row.sort_order,
          lifecycle,
          lifecycleArchive(lifecycle),
        ],
      );
      await this.audit(client, context, organisationId, 'MENU_ITEM_UPDATED', 'MenuItem', id, patch);
      return result.rows[0]!;
    });
  }

  async setMenuItemPrice(
    context: AdminContext,
    menuItemId: string,
    input: { salesLocationId: string | null; amountMinor: number; currency: string },
  ): Promise<MenuItemPriceRecord> {
    return this.database.transaction(async (client) => {
      const item = await this.menuItemRow(client, menuItemId);
      const organisationId = String(item.organisation_id);
      assertOrganisationAccess(context, organisationId);

      if (input.salesLocationId) {
        const location = await this.salesLocationRow(client, input.salesLocationId);
        if (String(location.organisation_id) !== organisationId)
          throw new ForbiddenException('Cross-organisation price override is not allowed');
        if (String(location.event_id) !== String(item.event_id))
          throw new BadRequestException('Price override location must belong to the menu event');
        const assignment = await client.query(
          `SELECT 1 FROM menu_assignments WHERE menu_id = $1 AND sales_location_id = $2`,
          [item.menu_id, input.salesLocationId],
        );
        if (assignment.rowCount === 0)
          throw new BadRequestException(
            'Price override requires the menu to be assigned to the sales location',
          );
      }

      const existing = await client.query<Row>(
        `SELECT id FROM menu_item_prices WHERE menu_item_id = $1 AND sales_location_id IS NOT DISTINCT FROM $2::uuid`,
        [menuItemId, input.salesLocationId],
      );
      const id = existing.rows[0] ? String(existing.rows[0].id) : randomUUID();
      const result = await client.query<MenuItemPriceRecord & QueryResultRow>(
        `INSERT INTO menu_item_prices
         (id, organisation_id, menu_item_id, sales_location_id, amount_minor, currency)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (menu_item_id, sales_location_id)
         DO UPDATE SET amount_minor = EXCLUDED.amount_minor, currency = EXCLUDED.currency, updated_at = now()
         RETURNING id, organisation_id AS "organisationId", menu_item_id AS "menuItemId",
                   sales_location_id AS "salesLocationId", amount_minor AS "amountMinor", currency,
                   created_at AS "createdAt", updated_at AS "updatedAt"`,
        [id, organisationId, menuItemId, input.salesLocationId, input.amountMinor, input.currency],
      );
      await this.audit(
        client,
        context,
        organisationId,
        'MENU_ITEM_PRICE_SET',
        'MenuItemPrice',
        result.rows[0]!.id,
        input,
      );
      return result.rows[0]!;
    });
  }

  async configurationView(
    context: AdminContext,
    organisationId: string,
  ): Promise<EventConfigurationView> {
    assertOrganisationAccess(context, organisationId);
    const organisation = await this.getOrganisation(context, organisationId);
    const [
      events,
      salesLocations,
      inventoryLocations,
      products,
      skus,
      menus,
      menuAssignments,
      menuItems,
      menuItemPrices,
    ] = await Promise.all([
      this.database.query<EventRecord>(
        `SELECT id, organisation_id AS "organisationId", name, timezone, lifecycle, starts_at AS "startsAt", ends_at AS "endsAt", archived_at AS "archivedAt", created_at AS "createdAt", updated_at AS "updatedAt" FROM events WHERE organisation_id = $1 ORDER BY created_at`,
        [organisationId],
      ),
      this.database.query<SalesLocationRecord>(
        `SELECT id, organisation_id AS "organisationId", event_id AS "eventId", name, type, lifecycle, archived_at AS "archivedAt", created_at AS "createdAt", updated_at AS "updatedAt" FROM sales_locations WHERE organisation_id = $1 ORDER BY created_at`,
        [organisationId],
      ),
      this.database.query<InventoryLocationRecord>(
        `SELECT id, organisation_id AS "organisationId", event_id AS "eventId", name, type, lifecycle, archived_at AS "archivedAt", created_at AS "createdAt", updated_at AS "updatedAt" FROM inventory_locations WHERE organisation_id = $1 ORDER BY created_at`,
        [organisationId],
      ),
      this.database.query<ProductRecord>(
        `SELECT id, organisation_id AS "organisationId", name, category, lifecycle, archived_at AS "archivedAt", created_at AS "createdAt", updated_at AS "updatedAt" FROM products WHERE organisation_id = $1 ORDER BY created_at`,
        [organisationId],
      ),
      this.database.query<SkuRecord>(
        `SELECT id, organisation_id AS "organisationId", product_id AS "productId", name, code, unit_name AS "unitName", lifecycle, archived_at AS "archivedAt", created_at AS "createdAt", updated_at AS "updatedAt" FROM skus WHERE organisation_id = $1 ORDER BY created_at`,
        [organisationId],
      ),
      this.database.query<MenuRecord>(
        `SELECT id, organisation_id AS "organisationId", event_id AS "eventId", name, lifecycle, archived_at AS "archivedAt", created_at AS "createdAt", updated_at AS "updatedAt" FROM menus WHERE organisation_id = $1 ORDER BY created_at`,
        [organisationId],
      ),
      this.database.query<MenuAssignmentRecord>(
        `SELECT id, organisation_id AS "organisationId", menu_id AS "menuId", sales_location_id AS "salesLocationId", created_at AS "createdAt" FROM menu_assignments WHERE organisation_id = $1 ORDER BY created_at`,
        [organisationId],
      ),
      this.database.query<MenuItemRecord>(
        `SELECT id, organisation_id AS "organisationId", menu_id AS "menuId", sku_id AS "skuId", display_name AS "displayName", sort_order AS "sortOrder", lifecycle, archived_at AS "archivedAt", created_at AS "createdAt", updated_at AS "updatedAt" FROM menu_items WHERE organisation_id = $1 ORDER BY created_at`,
        [organisationId],
      ),
      this.database.query<MenuItemPriceRecord>(
        `SELECT id, organisation_id AS "organisationId", menu_item_id AS "menuItemId", sales_location_id AS "salesLocationId", amount_minor AS "amountMinor", currency, created_at AS "createdAt", updated_at AS "updatedAt" FROM menu_item_prices WHERE organisation_id = $1 ORDER BY created_at`,
        [organisationId],
      ),
    ]);
    return {
      organisation,
      events,
      salesLocations,
      inventoryLocations,
      products,
      skus,
      menus,
      menuAssignments,
      menuItems,
      menuItemPrices,
    };
  }
}
