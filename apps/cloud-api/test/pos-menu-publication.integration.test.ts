import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import type { PublishedPosMenuSnapshot } from '../src/sync/pos-menu-publication.service';
import { publishedPosMenuChecksum } from '../src/sync/pos-menu-publication.service';
import { grantOperatorMembership, provisionOperator } from './operator-auth-testkit';
import { provisionSyncEdge } from './sync-auth-testkit';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration('pre-open POS menu publication', () => {
  let app: INestApplication;
  let database: DatabaseService;
  const platformActorId = randomUUID();
  const organisationActorId = randomUUID();
  let platformHeaders: (organisationId?: string) => Record<string, string>;
  let organisationHeaders: (organisationId?: string) => Record<string, string>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    database = moduleRef.get(DatabaseService);
    await app.init();

    const platform = await provisionOperator(database, {
      actorId: platformActorId,
      displayName: 'Publication platform admin',
      platformAdmin: true,
    });
    platformHeaders = platform.headers;
    const organisationAdmin = await provisionOperator(database, {
      actorId: organisationActorId,
      displayName: 'Publication organisation admin',
    });
    organisationHeaders = organisationAdmin.headers;
  });

  afterAll(async () => {
    await app.close();
  });

  it('publishes immutable snapshots and records only authenticated exact-match Edge installs', async () => {
    const organisation = (
      await request(app.getHttpServer())
        .post('/organisations')
        .set(platformHeaders())
        .send({ name: 'Publication Festival Operator' })
        .expect(201)
    ).body as { id: string };
    await grantOperatorMembership(database, organisationActorId, organisation.id, 'ADMIN');

    const event = (
      await request(app.getHttpServer())
        .post('/events')
        .set(organisationHeaders(organisation.id))
        .send({
          organisationId: organisation.id,
          name: 'Publication Festival',
          timezone: 'Africa/Nairobi',
          startsAt: '2026-10-10T18:00:00+03:00',
          endsAt: '2026-10-11T02:00:00+03:00',
        })
        .expect(201)
    ).body as { id: string };

    const location = (
      await request(app.getHttpServer())
        .post(`/events/${event.id}/sales-locations`)
        .set(organisationHeaders(organisation.id))
        .send({ name: 'Main Bar', type: 'BAR' })
        .expect(201)
    ).body as { id: string };

    const product = (
      await request(app.getHttpServer())
        .post('/products')
        .set(organisationHeaders(organisation.id))
        .send({ organisationId: organisation.id, name: 'Water', category: 'Soft Drinks' })
        .expect(201)
    ).body as { id: string };
    const sku = (
      await request(app.getHttpServer())
        .post(`/products/${product.id}/skus`)
        .set(organisationHeaders(organisation.id))
        .send({ name: 'Water 500ml', code: `WATER-${randomUUID()}`, unitName: 'bottle' })
        .expect(201)
    ).body as { id: string };
    const menu = (
      await request(app.getHttpServer())
        .post(`/events/${event.id}/menus`)
        .set(organisationHeaders(organisation.id))
        .send({ name: 'Main Menu' })
        .expect(201)
    ).body as { id: string };
    await request(app.getHttpServer())
      .post(`/menus/${menu.id}/assignments`)
      .set(organisationHeaders(organisation.id))
      .send({ salesLocationId: location.id })
      .expect(201);
    const item = (
      await request(app.getHttpServer())
        .post(`/menus/${menu.id}/items`)
        .set(organisationHeaders(organisation.id))
        .send({ skuId: sku.id, displayName: 'Water 500ml', sortOrder: 10 })
        .expect(201)
    ).body as { id: string };
    await request(app.getHttpServer())
      .put(`/menu-items/${item.id}/prices`)
      .set(organisationHeaders(organisation.id))
      .send({ amountMinor: 10_000, currency: 'KES' })
      .expect(200);

    const first = (
      await request(app.getHttpServer())
        .post(`/events/${event.id}/pos-menu-publications`)
        .set(organisationHeaders(organisation.id))
        .send({})
        .expect(201)
    ).body as PublishedPosMenuSnapshot[];

    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      eventId: event.id,
      salesLocationId: location.id,
      menuId: menu.id,
      version: 1,
      sourceActor: organisationActorId,
      currency: 'KES',
    });
    expect(first[0]?.items).toEqual([
      expect.objectContaining({
        itemId: item.id,
        skuId: sku.id,
        name: 'Water 500ml',
        category: 'Soft Drinks',
        priceMinor: 10_000,
        sortOrder: 10,
      }),
    ]);
    expect(first[0]?.checksum).toBe(
      publishedPosMenuChecksum({
        eventId: first[0]!.eventId,
        menuId: first[0]!.menuId,
        version: first[0]!.version,
        activatedAtEpochMs: first[0]!.activatedAtEpochMs,
        sourceActor: first[0]!.sourceActor,
        currency: first[0]!.currency,
        items: first[0]!.items,
      }),
    );

    const second = (
      await request(app.getHttpServer())
        .post(`/events/${event.id}/pos-menu-publications`)
        .set(organisationHeaders(organisation.id))
        .send({})
        .expect(201)
    ).body as PublishedPosMenuSnapshot[];
    expect(second[0]?.version).toBe(2);

    const rows = await database.query<{
      version: string;
      snapshot: PublishedPosMenuSnapshot;
    }>(
      `SELECT version::text,snapshot
       FROM pos_menu_publications
       WHERE event_id=$1 AND sales_location_id=$2
       ORDER BY version`,
      [event.id, location.id],
    );
    expect(rows.map((row) => row.version)).toEqual(['1', '2']);
    expect(rows[0]?.snapshot.checksum).toBe(first[0]?.checksum);
    expect(rows[1]?.snapshot.checksum).toBe(second[0]?.checksum);

    const edge = await provisionSyncEdge(database, {
      edgeId: `publication-edge-${randomUUID()}`,
      organisationId: organisation.id,
      eventIds: [event.id],
    });
    const latest = second[0]!;

    await request(app.getHttpServer())
      .post(`/sync/events/${event.id}/pos-menu-install-receipts`)
      .set(edge.headers)
      .send({
        installations: [
          {
            salesLocationId: latest.salesLocationId,
            version: latest.version,
            checksum: '00000000',
          },
        ],
      })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/sync/events/${event.id}/pos-menu-install-receipts`)
      .set(edge.headers)
      .send({
        installations: [
          {
            salesLocationId: latest.salesLocationId,
            version: latest.version,
            checksum: latest.checksum,
          },
        ],
      })
      .expect(201)
      .expect({ recorded: 1 });

    await request(app.getHttpServer())
      .post(`/sync/events/${event.id}/pos-menu-install-receipts`)
      .set(edge.headers)
      .send({
        installations: [
          {
            salesLocationId: latest.salesLocationId,
            version: latest.version,
            checksum: latest.checksum,
          },
        ],
      })
      .expect(201)
      .expect({ recorded: 1 });

    const receiptRows = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM pos_menu_install_receipts receipt
       JOIN pos_menu_publications publication ON publication.id=receipt.publication_id
       WHERE publication.event_id=$1 AND receipt.edge_id=$2`,
      [event.id, edge.headers['x-edge-id']],
    );
    expect(receiptRows[0]?.count).toBe('1');

    const status = (
      await request(app.getHttpServer())
        .get(`/events/${event.id}/pos-menu-publication-status`)
        .set(organisationHeaders(organisation.id))
        .expect(200)
    ).body as Array<{
      salesLocationId: string;
      version: number;
      checksum: string;
      installedEdges: Array<{ edgeId: string; reportedAt: string }>;
    }>;
    expect(status).toHaveLength(1);
    expect(status[0]).toMatchObject({
      salesLocationId: location.id,
      version: 2,
      checksum: latest.checksum,
    });
    expect(status[0]?.installedEdges).toEqual([
      expect.objectContaining({ edgeId: edge.headers['x-edge-id'] }),
    ]);

    const otherOrganisationId = randomUUID();
    const otherEdge = await provisionSyncEdge(database, {
      edgeId: `wrong-org-edge-${randomUUID()}`,
      organisationId: otherOrganisationId,
      eventIds: [randomUUID()],
    });
    await request(app.getHttpServer())
      .post(`/sync/events/${event.id}/pos-menu-install-receipts`)
      .set(otherEdge.headers)
      .send({
        installations: [
          {
            salesLocationId: latest.salesLocationId,
            version: latest.version,
            checksum: latest.checksum,
          },
        ],
      })
      .expect(401);

    await request(app.getHttpServer())
      .patch(`/events/${event.id}`)
      .set(organisationHeaders(organisation.id))
      .send({ lifecycle: 'ACTIVE' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/events/${event.id}/pos-menu-publications`)
      .set(organisationHeaders(organisation.id))
      .send({})
      .expect(409);

    const afterLock = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM pos_menu_publications WHERE event_id=$1',
      [event.id],
    );
    expect(afterLock[0]?.count).toBe('2');
  });

  it('fails closed before writing any publication when a sales location is not publishable', async () => {
    const organisation = (
      await request(app.getHttpServer())
        .post('/organisations')
        .set(platformHeaders())
        .send({ name: 'Incomplete Publication Operator' })
        .expect(201)
    ).body as { id: string };
    await grantOperatorMembership(database, organisationActorId, organisation.id, 'ADMIN');

    const event = (
      await request(app.getHttpServer())
        .post('/events')
        .set(organisationHeaders(organisation.id))
        .send({
          organisationId: organisation.id,
          name: 'Incomplete Publication Event',
          timezone: 'Africa/Nairobi',
          startsAt: '2026-11-10T18:00:00+03:00',
          endsAt: '2026-11-11T02:00:00+03:00',
        })
        .expect(201)
    ).body as { id: string };
    await request(app.getHttpServer())
      .post(`/events/${event.id}/sales-locations`)
      .set(organisationHeaders(organisation.id))
      .send({ name: 'Unconfigured Bar', type: 'BAR' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/events/${event.id}/pos-menu-publications`)
      .set(organisationHeaders(organisation.id))
      .send({})
      .expect(400);

    const rows = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM pos_menu_publications WHERE event_id=$1',
      [event.id],
    );
    expect(rows[0]?.count).toBe('0');
  });
});
