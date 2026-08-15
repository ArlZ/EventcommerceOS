import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { provisionOperator } from './operator-auth-testkit';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;
const organisationId = '11111111-1111-4111-8111-111111111111';
const eventId = '22222222-2222-4222-8222-222222222222';
const actorId = '33333333-3333-4333-8333-333333333333';
const salesLocationId = '44444444-4444-4444-8444-444444444444';
const reportId = '55555555-5555-4555-8555-555555555555';

describeIntegration('event close correction guard', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let headers: () => Record<string, string>;

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
         event_close_actions,event_close_reports,commerce_order_adjustments,
         sync_order_state,sales_locations,events,organisations CASCADE`,
    );
    await database.query(`INSERT INTO organisations(id,name) VALUES ($1,'Operator')`, [
      organisationId,
    ]);
    const operator = await provisionOperator(database, {
      actorId,
      memberships: [{ organisationId, role: 'ADMIN' }],
    });
    headers = () => operator.headers(organisationId);

    await database.query(
      `INSERT INTO events(id,organisation_id,name,timezone,lifecycle,starts_at,ends_at)
       VALUES ($1,$2,'Closed event','Africa/Nairobi','CLOSED',now()-interval '2 hours',now())`,
      [eventId, organisationId],
    );
    await database.query(
      `INSERT INTO sales_locations(id,organisation_id,event_id,name,type)
       VALUES ($1,$2,$3,'Main Bar','BAR')`,
      [salesLocationId, organisationId, eventId],
    );
    await database.query(
      `INSERT INTO sync_order_state(
         order_id,device_id,last_sequence,state,total_minor,currency,event_id,sales_location_id,
         lines,occurred_at,close_method,cashier_id
       ) VALUES ('order-1','device-1',2,'CLOSED',10000,'KES',$1,$2,'[]'::jsonb,now(),'CASH','cashier-a')`,
      [eventId, salesLocationId],
    );
    await database.query(
      `INSERT INTO commerce_order_adjustments(
         id,organisation_id,event_id,order_id,kind,amount_minor,currency,actor_id,
         device_id,cashier_id,reason,idempotency_key
       ) VALUES (
         'adjust-existing',$1,$2,'order-1','DISCOUNT',1000,'KES',$3,
         'device-1','cashier-a','Existing correction','adjust-existing-idem'
       )`,
      [organisationId, eventId, actorId],
    );
    await database.query(
      `INSERT INTO event_close_reports(
         id,organisation_id,event_id,revision,source_version_token,report_json,
         report_sha256,created_by_actor_id
       ) VALUES ($1,$2,$3,1,'source-v1','{}'::json,$4,$5)`,
      [reportId, organisationId, eventId, '0'.repeat(64), actorId],
    );
    await database.query(
      `INSERT INTO event_close_actions(
         id,organisation_id,event_id,action,actor_id,reason,report_id,close_revision
       ) VALUES ('close-1',$1,$2,'OPERATIONALLY_CLOSE',$3,'Initial close',$4,1)`,
      [organisationId, eventId, actorId, reportId],
    );
  });

  afterAll(async () => {
    delete process.env.PAYMENT_RECONCILIATION_DISABLED;
    await app.close();
  });

  it('replays prior idempotent correction but rejects new correction until reopen', async () => {
    const replay = {
      adjustmentId: 'adjust-existing',
      orderId: 'order-1',
      kind: 'DISCOUNT',
      amountMinor: 1000,
      currency: 'KES',
      reason: 'Existing correction',
      idempotencyKey: 'adjust-existing-idem',
    };
    await request(app.getHttpServer())
      .post(`/event-close/events/${eventId}/order-adjustments`)
      .set(headers())
      .send(replay)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/event-close/events/${eventId}/order-adjustments`)
      .set(headers())
      .send({
        ...replay,
        adjustmentId: 'adjust-new',
        amountMinor: 500,
        reason: 'New correction while closed',
        idempotencyKey: 'adjust-new-idem',
      })
      .expect(409);

    const rows = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM commerce_order_adjustments`,
    );
    expect(rows[0]?.count).toBe('1');
  });
});
