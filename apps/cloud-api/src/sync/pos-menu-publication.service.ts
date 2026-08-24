import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import type { AdminContext } from '../configuration/admin-context';
import { DatabaseService } from '../database/database.service';

export interface PublishedPosMenuItem {
  itemId: string;
  skuId: string;
  name: string;
  category: string;
  priceMinor: number;
  favourite: boolean;
  sortOrder: number;
}

export interface PublishedPosMenuSnapshot {
  eventId: string;
  salesLocationId: string;
  menuId: string;
  version: number;
  activatedAtEpochMs: number;
  sourceActor: string;
  currency: string;
  checksum: string;
  items: PublishedPosMenuItem[];
}

interface EventRow extends QueryResultRow {
  organisation_id: string;
  lifecycle: 'DRAFT' | 'ACTIVE' | 'CLOSED' | 'ARCHIVED';
}

interface LocationRow extends QueryResultRow {
  id: string;
}

interface MenuRow extends QueryResultRow {
  id: string;
}

interface ItemRow extends QueryResultRow {
  item_id: string;
  sku_id: string;
  name: string;
  category: string | null;
  sort_order: number;
  amount_minor: number | null;
  currency: string | null;
}

interface VersionRow extends QueryResultRow {
  version: string | null;
}

interface SnapshotRow extends QueryResultRow {
  snapshot: PublishedPosMenuSnapshot;
}

function appendField(parts: string[], value: string): void {
  parts.push(`${value.length}:${value}|`);
}

function crc32(value: string): string {
  let crc = 0xffffffff;
  for (const byte of Buffer.from(value, 'utf8')) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}

function compareItemIds(left: PublishedPosMenuItem, right: PublishedPosMenuItem): number {
  if (left.itemId < right.itemId) return -1;
  if (left.itemId > right.itemId) return 1;
  return 0;
}

export function publishedPosMenuChecksum(
  snapshot: Omit<PublishedPosMenuSnapshot, 'checksum' | 'salesLocationId'>,
): string {
  const parts: string[] = [];
  appendField(parts, snapshot.eventId);
  appendField(parts, snapshot.menuId);
  appendField(parts, snapshot.version.toString());
  appendField(parts, snapshot.activatedAtEpochMs.toString());
  appendField(parts, snapshot.sourceActor);
  appendField(parts, snapshot.currency);
  [...snapshot.items].sort(compareItemIds).forEach((item) => {
    appendField(parts, item.itemId);
    appendField(parts, item.skuId);
    appendField(parts, item.name);
    appendField(parts, item.category);
    appendField(parts, item.priceMinor.toString());
    appendField(parts, item.favourite ? '1' : '0');
    appendField(parts, item.sortOrder.toString());
  });
  return crc32(parts.join(''));
}

@Injectable()
export class PosMenuPublicationService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async publish(context: AdminContext, eventId: string): Promise<PublishedPosMenuSnapshot[]> {
    return this.database.transaction(async (client) => {
      const event = await this.lockDraftEvent(client, context, eventId);
      const locations = await client.query<LocationRow>(
        `SELECT id::text
         FROM sales_locations
         WHERE event_id=$1 AND organisation_id=$2 AND lifecycle='ACTIVE'
         ORDER BY id`,
        [eventId, event.organisation_id],
      );
      if (locations.rowCount === 0) {
        throw new BadRequestException('event must have at least one active sales location to publish');
      }

      const batchId = randomUUID();
      const activatedAtEpochMs = Date.now();
      const snapshots: PublishedPosMenuSnapshot[] = [];
      for (const location of locations.rows) {
        snapshots.push(
          await this.publishLocation(
            client,
            context,
            event.organisation_id,
            eventId,
            location.id,
            batchId,
            activatedAtEpochMs,
          ),
        );
      }

      await client.query(
        `INSERT INTO audit_events(
           id,organisation_id,actor_id,action,entity_type,entity_id,changes
         ) VALUES ($1,$2,$3,'POS_MENUS_PUBLISHED','Event',$4,$5::jsonb)`,
        [
          randomUUID(),
          event.organisation_id,
          context.actorId,
          eventId,
          JSON.stringify({
            batchId,
            locations: snapshots.map((snapshot) => ({
              salesLocationId: snapshot.salesLocationId,
              menuId: snapshot.menuId,
              version: snapshot.version,
              checksum: snapshot.checksum,
            })),
          }),
        ],
      );
      return snapshots;
    });
  }

  async latest(eventId: string): Promise<PublishedPosMenuSnapshot[]> {
    const rows = await this.database.query<SnapshotRow>(
      `SELECT DISTINCT ON (sales_location_id) snapshot
       FROM pos_menu_publications
       WHERE event_id=$1
       ORDER BY sales_location_id,version DESC`,
      [eventId],
    );
    if (rows.length === 0) throw new NotFoundException('no POS menu publication exists for event');
    return rows.map((row) => row.snapshot);
  }

  private async lockDraftEvent(
    client: PoolClient,
    context: AdminContext,
    eventId: string,
  ): Promise<EventRow> {
    const result = await client.query<EventRow>(
      `SELECT organisation_id::text,lifecycle
       FROM events WHERE id=$1 FOR UPDATE`,
      [eventId],
    );
    const event = result.rows[0];
    if (!event) throw new NotFoundException('Event not found');
    if (context.organisationId && context.organisationId !== event.organisation_id) {
      throw new NotFoundException('Event not found');
    }
    if (event.lifecycle !== 'DRAFT') {
      throw new ConflictException('POS menus may only be published while the event is DRAFT');
    }
    return event;
  }

  private async publishLocation(
    client: PoolClient,
    context: AdminContext,
    organisationId: string,
    eventId: string,
    salesLocationId: string,
    batchId: string,
    activatedAtEpochMs: number,
  ): Promise<PublishedPosMenuSnapshot> {
    const menus = await client.query<MenuRow>(
      `SELECT menu.id::text
       FROM menu_assignments assignment
       JOIN menus menu
         ON menu.id=assignment.menu_id
        AND menu.organisation_id=assignment.organisation_id
       WHERE assignment.sales_location_id=$1
         AND assignment.organisation_id=$2
         AND menu.event_id=$3
         AND menu.lifecycle='ACTIVE'
       ORDER BY menu.id`,
      [salesLocationId, organisationId, eventId],
    );
    if (menus.rowCount !== 1) {
      throw new BadRequestException(
        `sales location ${salesLocationId} must have exactly one active menu assignment`,
      );
    }
    const menuId = menus.rows[0]!.id;

    const itemResult = await client.query<ItemRow>(
      `SELECT menu_item.id::text AS item_id,
              menu_item.sku_id::text AS sku_id,
              menu_item.display_name AS name,
              product.category,
              menu_item.sort_order,
              COALESCE(location_price.amount_minor,default_price.amount_minor) AS amount_minor,
              COALESCE(location_price.currency,default_price.currency)::text AS currency
       FROM menu_items menu_item
       JOIN skus sku
         ON sku.id=menu_item.sku_id
        AND sku.organisation_id=menu_item.organisation_id
        AND sku.lifecycle='ACTIVE'
       JOIN products product
         ON product.id=sku.product_id
        AND product.organisation_id=sku.organisation_id
        AND product.lifecycle='ACTIVE'
       LEFT JOIN menu_item_prices location_price
         ON location_price.menu_item_id=menu_item.id
        AND location_price.organisation_id=menu_item.organisation_id
        AND location_price.sales_location_id=$1
       LEFT JOIN menu_item_prices default_price
         ON default_price.menu_item_id=menu_item.id
        AND default_price.organisation_id=menu_item.organisation_id
        AND default_price.sales_location_id IS NULL
       WHERE menu_item.menu_id=$2
         AND menu_item.organisation_id=$3
         AND menu_item.lifecycle='ACTIVE'
       ORDER BY menu_item.sort_order,menu_item.id`,
      [salesLocationId, menuId, organisationId],
    );
    if (itemResult.rowCount === 0) {
      throw new BadRequestException(`menu ${menuId} must contain at least one active sellable item`);
    }
    const missingPrice = itemResult.rows.find(
      (item) => item.amount_minor === null || item.currency === null,
    );
    if (missingPrice) {
      throw new BadRequestException(
        `menu item ${missingPrice.item_id} has no price for sales location ${salesLocationId}`,
      );
    }
    const currencies = new Set(itemResult.rows.map((item) => item.currency));
    if (currencies.size !== 1) {
      throw new BadRequestException(`menu ${menuId} must use one currency per sales location`);
    }
    const currency = itemResult.rows[0]!.currency!;
    const items: PublishedPosMenuItem[] = itemResult.rows.map((item) => ({
      itemId: item.item_id,
      skuId: item.sku_id,
      name: item.name,
      category: item.category?.trim() || 'Uncategorised',
      priceMinor: item.amount_minor!,
      favourite: false,
      sortOrder: item.sort_order,
    }));

    const versionRows = await client.query<VersionRow>(
      `SELECT max(version)::text AS version
       FROM pos_menu_publications
       WHERE event_id=$1 AND sales_location_id=$2`,
      [eventId, salesLocationId],
    );
    const previousVersion = versionRows.rows[0]?.version;
    const version =
      previousVersion === null || previousVersion === undefined
        ? 1
        : Number(BigInt(previousVersion) + 1n);
    if (!Number.isSafeInteger(version)) {
      throw new ConflictException('POS menu publication version exceeds safe integer range');
    }

    const unsigned = {
      eventId,
      menuId,
      version,
      activatedAtEpochMs,
      sourceActor: context.actorId,
      currency,
      items,
    };
    const snapshot: PublishedPosMenuSnapshot = {
      ...unsigned,
      salesLocationId,
      checksum: publishedPosMenuChecksum(unsigned),
    };

    await client.query(
      `INSERT INTO pos_menu_publications(
         id,batch_id,organisation_id,event_id,sales_location_id,menu_id,
         version,checksum,snapshot,published_by,published_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,to_timestamp($11 / 1000.0))`,
      [
        randomUUID(),
        batchId,
        organisationId,
        eventId,
        salesLocationId,
        menuId,
        version,
        snapshot.checksum,
        JSON.stringify(snapshot),
        context.actorId,
        activatedAtEpochMs,
      ],
    );
    return snapshot;
  }
}
