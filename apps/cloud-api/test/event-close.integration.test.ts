import 'reflect-metadata';
import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;
const organisationId = '11111111-1111-4111-8111-111111111111';
const eventId = '22222222-2222-4222-8222-222222222222';
const actorId = '33333333-3333-4333-8333-333333333333';
const barOneId = '44444444-4444-4444-8444-444444444444';
const barTwoId = '55555555-5555-4555-8555-555555555555';
const inventoryOneId = '66666666-6666-4666-8666-666666666666';
const inventoryTwoId = '77777777-7777-4777-8777-777777777777';
const productId = '88888888-8888-4888-8888-888888888888';
const skuId = '99999999-9999-4999-8999-999999999999';

function headers() {
  return {
    'x-actor-id': actorId,
    'x-role': 'ADMIN',
    'x-organisation-id': organisationId,
  };
}

function amount(report: { currency: string; amountMinor: string }[], currency = 'KES') {
  return report.find((entry) => entry.currency === currency)?.amountMinor ?? '0';
}

describeIntegration('event operational close and post-close reconciliation', () => {
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
         event_close_actions,
         event_close_reports,
         event_inventory_unit_cost_declarations,
         event_cash_declarations,
         commerce_order_adjustments,
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
    await database.query(`INSERT INTO organisations(id,name) VALUES ($1,'Operator')`, [
      organisationId,
    ]);
    await database.query(
      `INSERT INTO events(id,organisation_id,name,timezone,lifecycle,starts_at,ends_at)
       VALUES ($1,$2,'Close Test Event','Africa/Nairobi','CLOSED',now()-interval '8 hours',now())`,
      [eventId, organisationId],
    );
    await database.query(
      `INSERT INTO sales_locations(id,organisation_id,event_id,name,type)
       VALUES ($1,$3,$4,'Main Bar','BAR'),($2,$3,$4,'Garden Bar','BAR')`,
      [barOneId, barTwoId, organisationId, eventId],
    );
    await database.query(
      `INSERT INTO inventory_locations(id,organisation_id,event_id,name,type)
       VALUES ($1,$3,$4,'Main Store','WAREHOUSE'),($2,$3,$4,'Garden Store','BAR_STORAGE')`,
      [inventoryOneId, inventoryTwoId, organisationId, eventId],
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
         order_id,device_id,last_sequence,state,total_minor,currency,event_id,sales_location_id,
         lines,occurred_at,close_method,cashier_id
       ) VALUES
         ('order-cash','device-cash',2,'CLOSED',10000,'KES',$1,$2,'[]'::jsonb,now()-interval '6 hours','CASH','cashier-a'),
         ('order-provider-1','device-provider-1',2,'CLOSED',20000,'KES',$1,$2,'[]'::jsonb,now()-interval '5 hours','PROVIDER','cashier-a'),
         ('order-provider-2','device-provider-2',2,'CLOSED',30000,'KES',$1,$3,'[]'::jsonb,now()-interval '4 hours','PROVIDER','cashier-b')`,
      [eventId, barOneId, barTwoId],
    );

    await database.query(
      `INSERT INTO payments(id,event_id,order_id,amount_minor,currency)
       VALUES
         ('payment-provider-1',$1,'order-provider-1',15000,'KES'),
         ('payment-provider-2',$1,'order-provider-2',30000,'KES')`,
      [eventId],
    );
    await database.query(
      `INSERT INTO payment_attempts(
         id,payment_id,provider_id,idempotency_key,status,provider_reference,
         request_fingerprint,initiated_at,resolved_at,updated_at
       ) VALUES
         ('attempt-provider-1','payment-provider-1','mpesa','close-test-1','SUCCEEDED','mpesa-ref-1','fp-1',now()-interval '5 hours',now()-interval '5 hours',now()-interval '5 hours'),
         ('attempt-provider-2','payment-provider-2','pesapal_sabi','close-test-2','UNKNOWN',NULL,'fp-2',now()-interval '4 hours',NULL,now()-interval '4 hours')`,
    );
    await database.query(
      `INSERT INTO payment_reconciliation_jobs(payment_attempt_id,status,last_error_code)
       VALUES ('attempt-provider-2','MANUAL_REVIEW','MISSING_PROVIDER_REFERENCE')`,
    );
    await database.query(
      `INSERT INTO payment_refunds(
         id,payment_id,provider_id,source_provider_reference,amount_minor,currency,reason,
         requesting_actor_id,provider_reference,idempotency_key,status,created_at,updated_at
       ) VALUES (
         'refund-1','payment-provider-1','mpesa','mpesa-ref-1',4000,'KES','Customer refund',$1,
         'refund-ref-1','refund-idem-1','SUCCEEDED',now()-interval '3 hours',now()-interval '3 hours'
       )`,
      [actorId],
    );

    await database.query(
      `INSERT INTO inventory_edge_events(id,event_type,aggregate_type,aggregate_id,payload)
       VALUES
         ('edge-count','INVENTORY_COUNT_CLOSED','STOCK_COUNT','count-1','{}'::jsonb),
         ('edge-transfer','INVENTORY_TRANSFER_UPSERTED','INVENTORY_TRANSFER','transfer-1','{}'::jsonb),
         ('edge-alert','INVENTORY_ALERT_UPSERTED','INVENTORY_ALERT','alert-1','{}'::jsonb)`,
    );
    await database.query(
      `INSERT INTO inventory_count_projection(id,event_id,inventory_location_id,state,payload,edge_event_id)
       VALUES ('count-1',$1,$2,'CLOSED',$3::jsonb,'edge-count')`,
      [
        eventId,
        inventoryOneId,
        JSON.stringify({
          id: 'count-1',
          eventId,
          inventoryLocationId: inventoryOneId,
          state: 'CLOSED',
          closedAt: new Date().toISOString(),
          lines: [
            {
              skuId,
              countedQuantityBase: '95',
              expectedQuantityBase: '100',
              adjustmentLedgerId: 'count-adjustment-1',
            },
          ],
        }),
      ],
    );
    await database.query(
      `INSERT INTO inventory_transfer_projection(
         id,event_id,source_location_id,destination_location_id,state,assigned_actor_id,
         lines,source_updated_at,edge_event_id
       ) VALUES ('transfer-1',$1,$2,$3,'DISPATCHED',$4,$5::jsonb,now()-interval '2 hours','edge-transfer')`,
      [
        eventId,
        inventoryOneId,
        inventoryTwoId,
        actorId,
        JSON.stringify([{ skuId, requestedQuantityBase: '20', dispatchedQuantityBase: '20' }]),
      ],
    );
    await database.query(
      `INSERT INTO inventory_alert_projection(
         id,alert_type,severity,state,event_id,inventory_location_id,sku_id,
         available_quantity,minutes_of_cover,opened_at,edge_event_id
       ) VALUES ('alert-1','STOCKOUT_RISK','CRITICAL','OPEN',$1,$2,$3,3,12.5,now()-interval '1 hour','edge-alert')`,
      [eventId, inventoryOneId, skuId],
    );
  });

  afterAll(async () => {
    delete process.env.PAYMENT_RECONCILIATION_DISABLED;
    await app.close();
  });

  it('closes with explicit uncertainty, preserves revision 1, and reconciles late provider truth', async () => {
    const discount = {
      adjustmentId: 'adjust-discount',
      orderId: 'order-cash',
      kind: 'DISCOUNT',
      amountMinor: 1000,
      currency: 'KES',
      reason: 'Closing discount reconciliation',
      idempotencyKey: 'adjust-idem-discount',
    };
    await request(app.getHttpServer())
      .post(`/event-close/events/${eventId}/order-adjustments`)
      .set(headers())
      .send(discount)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/event-close/events/${eventId}/order-adjustments`)
      .set(headers())
      .send(discount)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/event-close/events/${eventId}/order-adjustments`)
      .set(headers())
      .send({
        adjustmentId: 'adjust-comp',
        orderId: 'order-provider-1',
        kind: 'COMP',
        amountMinor: 2000,
        currency: 'KES',
        reason: 'Approved comp',
        idempotencyKey: 'adjust-idem-comp',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/event-close/events/${eventId}/order-adjustments`)
      .set(headers())
      .send({
        adjustmentId: 'adjust-void',
        orderId: 'order-provider-1',
        kind: 'VOID',
        amountMinor: 3000,
        currency: 'KES',
        reason: 'Approved partial void',
        idempotencyKey: 'adjust-idem-void',
      })
      .expect(201);

    const adjustmentCount = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM commerce_order_adjustments`,
    );
    expect(adjustmentCount[0]?.count).toBe('3');

    await request(app.getHttpServer())
      .post(`/event-close/events/${eventId}/cash-declarations`)
      .set(headers())
      .send({
        declarationId: 'cash-declaration-1',
        salesLocationId: barOneId,
        deviceId: 'device-cash',
        cashierId: 'cashier-a',
        currency: 'KES',
        declaredMinor: 8800,
        reason: 'Drawer count',
        idempotencyKey: 'cash-idem-1',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/event-close/events/${eventId}/inventory-unit-costs`)
      .set(headers())
      .send({
        declarationId: 'cost-declaration-1',
        skuId,
        currency: 'KES',
        unitCostMinor: 200,
        reason: 'Event standard landed cost per bottle',
        idempotencyKey: 'cost-idem-1',
      })
      .expect(201);

    const preClose = await request(app.getHttpServer())
      .get(`/event-close/events/${eventId}/report`)
      .set(headers())
      .expect(200);
    expect(amount(preClose.body.sales.grossSales)).toBe('60000');
    expect(amount(preClose.body.sales.discounts)).toBe('1000');
    expect(amount(preClose.body.sales.comps)).toBe('2000');
    expect(amount(preClose.body.sales.voids)).toBe('3000');
    expect(amount(preClose.body.sales.refunds)).toBe('4000');
    expect(amount(preClose.body.sales.netSales)).toBe('50000');
    expect(preClose.body.paymentMethods).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ methodId: 'cash', currency: 'KES', succeededCount: 1 }),
      ]),
    );
    expect(preClose.body.cash.summary).toEqual([
      {
        currency: 'KES',
        expectedMinor: '9000',
        declaredMinor: '8800',
        varianceMinor: '-200',
        declarationStatus: 'COMPLETE',
      },
    ]);
    expect(preClose.body.inventoryVariances[0]).toMatchObject({
      skuId,
      expectedQuantityBase: '100',
      physicalQuantityBase: '95',
      varianceQuantityBase: '-5',
      unitCostMinor: '200',
      valuationCurrency: 'KES',
      varianceValueMinor: '-1000',
      valuationStatus: 'VALUED',
    });
    expect(preClose.body.unresolvedPayments).toHaveLength(1);
    expect(preClose.body.unresolvedPayments[0]).toMatchObject({
      paymentAttemptId: 'attempt-provider-2',
      status: 'UNKNOWN',
    });
    expect(preClose.body.openTransfers).toHaveLength(1);
    expect(preClose.body.unresolvedCriticalAlerts).toHaveLength(1);
    expect(
      preClose.body.drilldowns.find(
        (row: { dimensionType: string; dimensionId: string }) =>
          row.dimensionType === 'CASHIER' && row.dimensionId === 'cashier-a',
      ),
    ).toMatchObject({
      grossSalesMinor: '30000',
      netSalesMinor: '20000',
    });
    expect(preClose.body.financialReconciliation).toEqual([
      expect.objectContaining({
        currency: 'KES',
        netSalesMinor: '50000',
        cashExpectedMinor: '9000',
        accountedTenderMinor: '19800',
        conclusive: false,
      }),
    ]);

    const closed = await request(app.getHttpServer())
      .post(`/event-close/events/${eventId}/close`)
      .set(headers())
      .send({ actionId: 'close-action-1', reason: 'Operational close after physical count' })
      .expect(201);
    expect(closed.body.revision).toBe(1);
    expect(closed.body.report.close).toMatchObject({
      state: 'OPERATIONALLY_CLOSED',
      lastClosedRevision: 1,
      sourceChangedSinceLastClose: false,
    });
    expect(closed.body.report.unresolvedPayments).toHaveLength(1);
    expect(closed.body.sha256).toHaveLength(64);
    expect(
      createHash('sha256').update(JSON.stringify(closed.body.report)).digest('hex'),
    ).toBe(closed.body.sha256);

    const closeReplay = await request(app.getHttpServer())
      .post(`/event-close/events/${eventId}/close`)
      .set(headers())
      .send({ actionId: 'close-action-1', reason: 'Operational close after physical count' })
      .expect(201);
    expect(closeReplay.body.reportId).toBe(closed.body.reportId);

    await database.query(
      `UPDATE payment_attempts
       SET status='SUCCEEDED',provider_reference='sabi-confirm-late',failure_code=NULL,
           resolved_at=now(),updated_at=now()
       WHERE id='attempt-provider-2'`,
    );
    await database.query(
      `UPDATE payment_reconciliation_jobs
       SET status='RESOLVED',last_error_code=NULL,updated_at=now()
       WHERE payment_attempt_id='attempt-provider-2'`,
    );

    const liveAfterLateTruth = await request(app.getHttpServer())
      .get(`/event-close/events/${eventId}/report`)
      .set(headers())
      .expect(200);
    expect(liveAfterLateTruth.body.close).toMatchObject({
      state: 'OPERATIONALLY_CLOSED',
      lastClosedRevision: 1,
      sourceChangedSinceLastClose: true,
    });
    expect(liveAfterLateTruth.body.unresolvedPayments).toEqual([]);
    expect(liveAfterLateTruth.body.financialReconciliation[0]).toMatchObject({
      currency: 'KES',
      netSalesMinor: '50000',
      electronicNetTenderMinor: '41000',
      cashExpectedMinor: '9000',
      accountedTenderMinor: '49800',
      salesToTenderVarianceMinor: '-200',
      conclusive: true,
    });

    const storedRevisionOne = await request(app.getHttpServer())
      .get(`/event-close/events/${eventId}/reports/1`)
      .set(headers())
      .expect(200);
    expect(storedRevisionOne.body.sha256).toBe(closed.body.sha256);
    expect(storedRevisionOne.body.report.unresolvedPayments).toHaveLength(1);
    expect(storedRevisionOne.body.report.sourceVersionToken).toBe(
      closed.body.report.sourceVersionToken,
    );

    await request(app.getHttpServer())
      .post(`/event-close/events/${eventId}/close`)
      .set(headers())
      .send({ actionId: 'close-action-without-reopen', reason: 'Should fail' })
      .expect(409);

    await request(app.getHttpServer())
      .post(`/event-close/events/${eventId}/reopen`)
      .set(headers())
      .send({ actionId: 'reopen-action-1', reason: 'Reconcile late Sabi confirmation' })
      .expect(201);

    const revisionTwo = await request(app.getHttpServer())
      .post(`/event-close/events/${eventId}/close`)
      .set(headers())
      .send({ actionId: 'close-action-2', reason: 'Re-close after provider reconciliation' })
      .expect(201);
    expect(revisionTwo.body.revision).toBe(2);
    expect(revisionTwo.body.report.unresolvedPayments).toEqual([]);
    expect(revisionTwo.body.report.close).toMatchObject({
      state: 'OPERATIONALLY_CLOSED',
      lastClosedRevision: 2,
      sourceChangedSinceLastClose: false,
    });

    const actions = await request(app.getHttpServer())
      .get(`/event-close/events/${eventId}/actions`)
      .set(headers())
      .expect(200);
    expect(actions.body.map((action: { action: string }) => action.action)).toEqual([
      'OPERATIONALLY_CLOSE',
      'REOPEN',
      'OPERATIONALLY_CLOSE',
    ]);

    const csv = await request(app.getHttpServer())
      .get(`/event-close/events/${eventId}/reports/2/export.csv`)
      .set(headers())
      .expect(200)
      .expect('Content-Type', /text\/csv/);
    expect(Buffer.from(csv.body).toString('utf8')).toContain('FINANCIAL_RECONCILIATION');
  });
});
