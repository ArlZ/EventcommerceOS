import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  EventConfigurationView,
  EventRecord,
  MenuItemPriceRecord,
  OrganisationRecord,
  ProductRecord,
  SalesLocationRecord,
  SkuRecord,
} from '@event-commerce/contracts';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { grantOperatorMembership, provisionOperator } from './operator-auth-testkit';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration('event configuration vertical slice', () => {
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
      displayName: 'Configuration platform admin',
      platformAdmin: true,
    });
    platformHeaders = platform.headers;
    const organisationAdmin = await provisionOperator(database, {
      actorId: organisationActorId,
      displayName: 'Configuration organisation admin',
    });
    organisationHeaders = organisationAdmin.headers;
  });

  afterAll(async () => {
    await app.close();
  });

  it('has applied the empty-database migration', async () => {
    const migrations = await database.query<{ filename: string }>(
      'SELECT filename FROM schema_migrations ORDER BY filename',
    );
    expect(migrations.map((row) => row.filename)).toContain('0001_event_configuration.sql');
    expect(migrations.map((row) => row.filename)).toContain('0013_operator_auth.sql');
  });

  it('creates a tenant-safe event, location and catalogue configuration', async () => {
    const organisationOne = (
      await request(app.getHttpServer())
        .post('/organisations')
        .set(platformHeaders())
        .send({ name: 'Festival Operator' })
        .expect(201)
    ).body as OrganisationRecord;
    const organisationTwo = (
      await request(app.getHttpServer())
        .post('/organisations')
        .set(platformHeaders())
        .send({ name: 'Other Operator' })
        .expect(201)
    ).body as OrganisationRecord;

    await grantOperatorMembership(database, organisationActorId, organisationOne.id, 'ADMIN');

    await request(app.getHttpServer())
      .post('/events')
      .set(organisationHeaders(organisationOne.id))
      .send({
        organisationId: organisationOne.id,
        name: 'Bad Timezone Event',
        timezone: 'Nairobi/Invalid',
        startsAt: '2026-09-01T18:00:00+03:00',
        endsAt: '2026-09-02T02:00:00+03:00',
      })
      .expect(400);

    const event = (
      await request(app.getHttpServer())
        .post('/events')
        .set(organisationHeaders(organisationOne.id))
        .send({
          organisationId: organisationOne.id,
          name: 'Nairobi Live',
          timezone: 'Africa/Nairobi',
          startsAt: '2026-09-01T18:00:00+03:00',
          endsAt: '2026-09-02T02:00:00+03:00',
        })
        .expect(201)
    ).body as EventRecord;
    expect(event.timezone).toBe('Africa/Nairobi');
    expect(new Date(event.startsAt).toISOString()).toBe('2026-09-01T15:00:00.000Z');

    const secondEvent = (
      await request(app.getHttpServer())
        .post('/events')
        .set(organisationHeaders(organisationOne.id))
        .send({
          organisationId: organisationOne.id,
          name: 'Second Event',
          timezone: 'Africa/Nairobi',
          startsAt: '2026-10-01T18:00:00+03:00',
          endsAt: '2026-10-02T02:00:00+03:00',
        })
        .expect(201)
    ).body as EventRecord;

    await request(app.getHttpServer())
      .post(`/events/${event.id}/sales-locations`)
      .set(organisationHeaders(organisationTwo.id))
      .send({ name: 'Forbidden Bar', type: 'BAR' })
      .expect(403);

    const mainStage = (
      await request(app.getHttpServer())
        .post(`/events/${event.id}/sales-locations`)
        .set(organisationHeaders(organisationOne.id))
        .send({ name: 'Main Stage Bar', type: 'BAR' })
        .expect(201)
    ).body as SalesLocationRecord;
    const vipBar = (
      await request(app.getHttpServer())
        .post(`/events/${event.id}/sales-locations`)
        .set(organisationHeaders(organisationOne.id))
        .send({ name: 'VIP Bar', type: 'BAR' })
        .expect(201)
    ).body as SalesLocationRecord;
    const otherEventBar = (
      await request(app.getHttpServer())
        .post(`/events/${secondEvent.id}/sales-locations`)
        .set(organisationHeaders(organisationOne.id))
        .send({ name: 'Other Event Bar', type: 'BAR' })
        .expect(201)
    ).body as SalesLocationRecord;

    await request(app.getHttpServer())
      .post(`/events/${event.id}/inventory-locations`)
      .set(organisationHeaders(organisationOne.id))
      .send({ name: 'Central Warehouse', type: 'WAREHOUSE' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/events/${event.id}/inventory-locations`)
      .set(organisationHeaders(organisationOne.id))
      .send({ name: 'Main Stage Store', type: 'BAR_STORAGE' })
      .expect(201);

    const product = (
      await request(app.getHttpServer())
        .post('/products')
        .set(organisationHeaders(organisationOne.id))
        .send({ organisationId: organisationOne.id, name: 'Tusker', category: 'Beer' })
        .expect(201)
    ).body as ProductRecord;
    const sku = (
      await request(app.getHttpServer())
        .post(`/products/${product.id}/skus`)
        .set(organisationHeaders(organisationOne.id))
        .send({
          name: 'Tusker 500ml',
          code: `TUSKER-500-${randomUUID().slice(0, 8)}`,
          unitName: '500ml bottle',
        })
        .expect(201)
    ).body as SkuRecord;
    const menu = (
      await request(app.getHttpServer())
        .post(`/events/${event.id}/menus`)
        .set(organisationHeaders(organisationOne.id))
        .send({ name: 'Event Menu' })
        .expect(201)
    ).body as { id: string };

    await request(app.getHttpServer())
      .post(`/menus/${menu.id}/assignments`)
      .set(organisationHeaders(organisationOne.id))
      .send({ salesLocationId: mainStage.id })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/menus/${menu.id}/assignments`)
      .set(organisationHeaders(organisationOne.id))
      .send({ salesLocationId: mainStage.id })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/menus/${menu.id}/assignments`)
      .set(organisationHeaders(organisationOne.id))
      .send({ salesLocationId: otherEventBar.id })
      .expect(400);

    const menuItem = (
      await request(app.getHttpServer())
        .post(`/menus/${menu.id}/items`)
        .set(organisationHeaders(organisationOne.id))
        .send({ skuId: sku.id, displayName: 'Tusker 500ml', sortOrder: 10 })
        .expect(201)
    ).body as { id: string };
    await request(app.getHttpServer())
      .put(`/menu-items/${menuItem.id}/prices`)
      .set(organisationHeaders(organisationOne.id))
      .send({ amountMinor: 250.5, currency: 'KES' })
      .expect(400);

    const defaultPrice = (
      await request(app.getHttpServer())
        .put(`/menu-items/${menuItem.id}/prices`)
        .set(organisationHeaders(organisationOne.id))
        .send({ amountMinor: 25000, currency: 'KES' })
        .expect(200)
    ).body as MenuItemPriceRecord;
    expect(defaultPrice.amountMinor).toBe(25000);

    await request(app.getHttpServer())
      .put(`/menu-items/${menuItem.id}/prices`)
      .set(organisationHeaders(organisationOne.id))
      .send({ salesLocationId: vipBar.id, amountMinor: 30000, currency: 'KES' })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/menus/${menu.id}/assignments`)
      .set(organisationHeaders(organisationOne.id))
      .send({ salesLocationId: vipBar.id })
      .expect(201);
    const vipPrice = (
      await request(app.getHttpServer())
        .put(`/menu-items/${menuItem.id}/prices`)
        .set(organisationHeaders(organisationOne.id))
        .send({ salesLocationId: vipBar.id, amountMinor: 30000, currency: 'KES' })
        .expect(200)
    ).body as MenuItemPriceRecord;
    expect(vipPrice.salesLocationId).toBe(vipBar.id);

    const configuration = (
      await request(app.getHttpServer())
        .get(`/organisations/${organisationOne.id}/configuration`)
        .set(organisationHeaders(organisationOne.id))
        .expect(200)
    ).body as EventConfigurationView;
    expect(configuration.salesLocations.map((location) => location.name)).toEqual(
      expect.arrayContaining(['Main Stage Bar', 'VIP Bar']),
    );
    expect(configuration.inventoryLocations.map((location) => location.name)).toEqual(
      expect.arrayContaining(['Central Warehouse', 'Main Stage Store']),
    );
    expect(configuration.skus.map((item) => item.name)).toContain('Tusker 500ml');
    expect(configuration.menuItemPrices).toHaveLength(2);

    await request(app.getHttpServer())
      .get(`/organisations/${organisationOne.id}/configuration`)
      .set({
        'x-actor-id': organisationActorId,
        'x-role': 'ADMIN',
        'x-organisation-id': organisationOne.id,
      })
      .expect(401);

    const auditRows = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM audit_events WHERE organisation_id = $1',
      [organisationOne.id],
    );
    expect(Number.parseInt(auditRows[0]!.count, 10)).toBeGreaterThanOrEqual(12);
  });
});
