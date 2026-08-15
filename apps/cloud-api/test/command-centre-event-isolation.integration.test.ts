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
const eventA = '22222222-2222-4222-8222-222222222222';
const eventB = '22222222-2222-4222-8222-333333333333';
const actorId = '33333333-3333-4333-8333-333333333333';

describeIntegration('command centre event isolation', () => {
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
         command_centre_alert_audit,
         command_centre_inventory_alert_control,
         inventory_alert_projection,
         inventory_edge_events,
         events,
         organisations
       CASCADE`,
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
       VALUES
         ($1,$3,'Event A','Africa/Nairobi','ACTIVE',now()-interval '1 hour',now()+interval '2 hours'),
         ($2,$3,'Event B','Africa/Nairobi','ACTIVE',now()-interval '1 hour',now()+interval '2 hours')`,
      [eventA, eventB, organisationId],
    );
    await database.query(
      `INSERT INTO inventory_edge_events(id,event_type,aggregate_type,aggregate_id,payload)
       VALUES ('edge-alert-a','INVENTORY_ALERT_UPSERTED','INVENTORY_ALERT','alert-a','{}'::jsonb)`,
    );
    await database.query(
      `INSERT INTO inventory_alert_projection(
         id,alert_type,severity,state,event_id,sku_id,available_quantity,
         opened_at,source_updated_at,edge_event_id
       ) VALUES (
         'alert-a','STOCKOUT_RISK','CRITICAL','OPEN',$1,'sku-a',0,
         now(),now(),'edge-alert-a'
       )`,
      [eventA],
    );
  });

  afterAll(async () => {
    delete process.env.PAYMENT_RECONCILIATION_DISABLED;
    await app.close();
  });

  it('does not allow an Event A inventory alert to be acted on through Event B', async () => {
    await request(app.getHttpServer())
      .post(`/command-centre/events/${eventB}/inventory-alerts/alert-a/actions`)
      .set(headers())
      .send({ action: 'ACKNOWLEDGE' })
      .expect(404);

    const audit = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM command_centre_alert_audit`,
    );
    expect(audit[0]?.count).toBe('0');

    const eventBSnapshot = await request(app.getHttpServer())
      .get(`/command-centre/events/${eventB}`)
      .set(headers())
      .expect(200);
    expect(eventBSnapshot.body.inventory.risks).toEqual([]);
  });
});
