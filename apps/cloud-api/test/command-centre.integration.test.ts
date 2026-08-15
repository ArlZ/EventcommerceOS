import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;
const organisationId = '11111111-1111-4111-8111-111111111111';
const otherOrganisationId = '11111111-1111-4111-8111-222222222222';
const eventId = '22222222-2222-4222-8222-222222222222';
const actorId = '33333333-3333-4333-8333-333333333333';
const assignedActorId = '44444444-4444-4444-8444-444444444444';
const salesLocationId = '55555555-5555-4555-8555-555555555555';
const inventoryLocationId = '66666666-6666-4666-8666-666666666666';
const productId = '77777777-7777-4777-8777-777777777777';
const skuId = '88888888-8888-4888-8888-888888888888';

function adminHeaders(organisation = organisationId) {
  return {
    'x-actor-id': actorId,
    'x-role': 'ADMIN',
    'x-organisation-id': organisation,
  };
}

describeIntegration('live event command centre', () => {
  let app: INestApplication;
  let database: DatabaseService;

  beforeAll(async () => {
    process.env.PAYMENT_RECONCILIATION_DISABLED = 'true';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    database = moduleRef.get(DatabaseService);
    await app.init();
  });

  beforeEach(async () => {
    await database.query(
      `TRUNCATE
         command_centre_alert_audit,
         command_centre_inventory_alert_control,
         inventory_reconciliation_exceptions,
         inventory_count_projection,
         inventory_alert_projection,
         inventory_transfer_projection,
         inventory_ledger,
         inventory_edge_events,
         payment_audit_events,
         payment_manual_terminal_confirmations,
         payment_actor_permissions,
         payment_provider_events,
         payment_reconciliation_jobs,
         payment_refunds,
         payment_reversals,
         payment_attempts,
         payments,
         sync_reconciliation_exceptions,
         sync_device_state,
         sync_order_state,
         sync_processed_events,
         audit_events,
         menu_item_prices,
         menu_items,
         menu_assignments,
         menus,
         skus,
         products,
         inventory_locations,
         sales_locations,
         events,
         organisations
       CASCADE`,
    );

    await database.query(
      `INSERT INTO organisations(id,name) VALUES ($1,'Event operator'),($2,'Other operator')`,
      [organisationId, otherOrganisationId],
    );
    await database.query(
      `INSERT INTO events(id,organisation_id,name,timezone,lifecycle,starts_at,ends_at)
       VALUES ($1,$2,'Festival Night','Africa/Nairobi','ACTIVE',now()-interval '2 hours',now()+interval '6 hours')`,
      [eventId, organisationId],
    );
    await database.query(
      `INSERT INTO sales_locations(id,organisation_id,event_id,name,type)
       VALUES ($1,$2,$3,'Main Bar','BAR')`,
      [salesLocationId, organisationId, eventId],
    );
    await database.query(
      `INSERT INTO inventory_locations(id,organisation_id,event_id,name,type)
       VALUES ($1,$2,$3,'Main Store','WAREHOUSE')`,
      [inventoryLocationId, organisationId, eventId],
    );
    await database.query(
      `INSERT INTO products(id,organisation_id,name,category) VALUES ($1,$2,'Water','Drinks')`,
      [productId, organisationId],
    );
    await database.query(
      `INSERT INTO skus(id,organisation_id,product_id,name,code,unit_name)
       VALUES ($1,$2,$3,'Water 500ml','WATER-500','bottle')`,
      [skuId, organisationId, productId],
    );

    await database.query(
      `INSERT INTO sync_order_state(
         order_id,device_id,last_sequence,state,total_minor,currency,event_id,
         sales_location_id,lines,occurred_at
       ) VALUES (
         'order-1','device-1',4,'CLOSED',10000,'KES',$1,$2,$3::jsonb,now()-interval '2 minutes'
       )`,
      [eventId, salesLocationId, JSON.stringify([{ skuId, quantity: 2, unitPriceMinor: 5000 }])],
    );
    await database.query(
      `INSERT INTO sync_device_state(
         device_id,last_seen_at,last_sequence_seen,edge_accepted_through_sequence,
         edge_backlog_count,last_cloud_delivery_at
       ) VALUES ('device-1',now()-interval '10 seconds',4,4,0,now()-interval '10 seconds')`,
    );

    await database.query(
      `INSERT INTO payments(id,event_id,order_id,amount_minor,currency)
       VALUES ('payment-1',$1,'order-1',10000,'KES'),
              ('payment-2',$1,'order-2',20000,'KES')`,
      [eventId],
    );
    await database.query(
      `INSERT INTO payment_attempts(
         id,payment_id,provider_id,idempotency_key,status,request_fingerprint,resolved_at,updated_at
       ) VALUES
         ('attempt-old','payment-1','mpesa','idem-old','SUCCEEDED','fp-old',now()-interval '2 minutes',now()-interval '2 minutes'),
         ('attempt-new','payment-1','pesapal_sabi','idem-new','SUCCEEDED','fp-new',now()-interval '1 minute',now()-interval '1 minute'),
         ('attempt-unknown','payment-2','mpesa','idem-unknown','UNKNOWN','fp-unknown',NULL,now())`,
    );

    await database.query(
      `INSERT INTO inventory_edge_events(id,event_type,aggregate_type,aggregate_id,payload)
       VALUES ('edge-alert-1','INVENTORY_ALERT_UPSERTED','INVENTORY_ALERT','alert-1','{}'::jsonb)`,
    );
    await database.query(
      `INSERT INTO inventory_alert_projection(
         id,alert_type,severity,state,event_id,inventory_location_id,sku_id,
         available_quantity,minutes_of_cover,opened_at,source_updated_at,edge_event_id
       ) VALUES (
         'alert-1','STOCKOUT_RISK','CRITICAL','OPEN',$1,$2,$3,4,8.5,
         now()-interval '5 minutes',now()-interval '5 minutes','edge-alert-1'
       )`,
      [eventId, inventoryLocationId, skuId],
    );
  });

  afterAll(async () => {
    delete process.env.PAYMENT_RECONCILIATION_DISABLED;
    await app.close();
  });

  it('returns actionable event truth without double-counting successful payment retries', async () => {
    const response = await request(app.getHttpServer())
      .get(`/command-centre/events/${eventId}`)
      .set(adminHeaders())
      .expect(200);

    expect(response.body.sales).toMatchObject({ transactionCount: 1 });
    expect(response.body.sales.grossSales).toEqual([{ currency: 'KES', amountMinor: '10000' }]);
    expect(response.body.topProducts[0]).toMatchObject({
      skuId,
      name: 'Water 500ml',
      quantitySold: '2',
    });
    expect(response.body.payments.settledMethods).toEqual([
      {
        providerId: 'pesapal_sabi',
        currency: 'KES',
        transactionCount: 1,
        valueMinor: '10000',
      },
    ]);
    expect(response.body.payments.attempts.unknownCount).toBe(1);
    expect(response.body.inventory.risks[0]).toMatchObject({
      alertId: 'alert-1',
      state: 'OPEN',
      skuName: 'Water 500ml',
    });
  });

  it('rejects cross-organisation access before returning event metrics', async () => {
    await request(app.getHttpServer())
      .get(`/command-centre/events/${eventId}`)
      .set(adminHeaders(otherOrganisationId))
      .expect(403);
  });

  it('audits acknowledge and assignment while Edge RESOLVED remains authoritative', async () => {
    const acknowledge = await request(app.getHttpServer())
      .post(`/command-centre/events/${eventId}/inventory-alerts/alert-1/actions`)
      .set(adminHeaders())
      .send({ action: 'ACKNOWLEDGE' })
      .expect(201);
    expect(acknowledge.body).toMatchObject({
      alertId: 'alert-1',
      previousState: 'OPEN',
      resultingState: 'ACKNOWLEDGED',
    });

    const assign = await request(app.getHttpServer())
      .post(`/command-centre/events/${eventId}/inventory-alerts/alert-1/actions`)
      .set(adminHeaders())
      .send({ action: 'ASSIGN', assignedActorId })
      .expect(201);
    expect(assign.body).toMatchObject({
      previousState: 'ACKNOWLEDGED',
      resultingState: 'ASSIGNED',
      assignedActorId,
    });

    const active = await request(app.getHttpServer())
      .get(`/command-centre/events/${eventId}`)
      .set(adminHeaders())
      .expect(200);
    expect(active.body.inventory.risks[0]).toMatchObject({
      state: 'ASSIGNED',
      assignedActorId,
    });

    const audit = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM command_centre_alert_audit WHERE alert_id='alert-1'`,
    );
    expect(audit[0]?.count).toBe('2');

    await database.query(
      `UPDATE inventory_alert_projection
       SET state='RESOLVED',source_updated_at=now(),updated_at=now()
       WHERE id='alert-1'`,
    );
    const resolved = await request(app.getHttpServer())
      .get(`/command-centre/events/${eventId}`)
      .set(adminHeaders())
      .expect(200);
    expect(resolved.body.inventory.risks).toEqual([]);
    expect(
      resolved.body.alerts.find((alert: { id: string }) => alert.id === 'inventory:alert-1'),
    ).toBeUndefined();
  });
});
