import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';

process.env.SECURITY_TEST_BYPASS = 'false';
process.env.SECURITY_BOOTSTRAP_SECRET = 'task011-bootstrap-secret-for-tests-only';
process.env.EDGE_SECURITY_SNAPSHOT_SECRET =
  'task011-edge-security-snapshot-signing-secret-for-tests';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;
const orgOne = '11000000-0000-4100-8100-000000000001';
const orgTwo = '11000000-0000-4100-8100-000000000002';
const eventOne = '22000000-0000-4200-8200-000000000001';
const eventTwo = '22000000-0000-4200-8200-000000000002';
const locationOne = '33000000-0000-4300-8300-000000000001';
const locationTwo = '33000000-0000-4300-8300-000000000002';
const bootstrapActor = '44000000-0000-4400-8400-000000000001';
const secondActor = '44000000-0000-4400-8400-000000000002';

function bearer(token: string, organisationId = orgOne) {
  return {
    authorization: `Bearer ${token}`,
    'x-organisation-id': organisationId,
    'x-actor-id': 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    'x-role': 'PLATFORM_ADMIN',
  };
}

function validEdgeBatch(edgeId: string, businessEventId = eventOne) {
  return {
    edgeId,
    events: [
      {
        schemaVersion: 1,
        eventInstanceId: 'security-test-instance-1',
        eventId: 'security-test-envelope-1',
        eventType: 'SECURITY_TEST',
        aggregateType: 'SECURITY_TEST',
        aggregateId: 'security-test-aggregate-1',
        eventVersion: 1,
        deviceId: 'security-test-device',
        sequence: 1,
        occurredAt: '2026-08-14T12:00:00.000Z',
        idempotencyKey: 'security-test-idempotency-1',
        payload: { eventId: businessEventId },
      },
    ],
    deviceStatuses: [],
  };
}

describeIntegration('Cloud operator, device and Event Edge security boundary', () => {
  let app: INestApplication;
  let database: DatabaseService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    database = moduleRef.get(DatabaseService);
  });

  beforeEach(async () => {
    process.env.SECURITY_TEST_BYPASS = 'false';
    await database.query(`DELETE FROM security_edge_credentials`);
    await database.query(`DELETE FROM security_device_credentials`);
    await database.query(`DELETE FROM security_operator_credentials`);
    await database.query(`DELETE FROM audit_events WHERE organisation_id IN ($1,$2)`, [
      orgOne,
      orgTwo,
    ]);
    await database.query(`DELETE FROM sales_locations WHERE id IN ($1,$2)`, [locationOne, locationTwo]);
    await database.query(`DELETE FROM events WHERE id IN ($1,$2)`, [eventOne, eventTwo]);
    await database.query(`DELETE FROM organisations WHERE id IN ($1,$2)`, [orgOne, orgTwo]);
    await database.query(
      `INSERT INTO organisations(id,name) VALUES ($1,'Security Org One'),($2,'Security Org Two')`,
      [orgOne, orgTwo],
    );
    await database.query(
      `INSERT INTO events(id,organisation_id,name,timezone,lifecycle,starts_at,ends_at)
       VALUES
         ($1,$2,'Security Event One','Africa/Nairobi','ACTIVE','2026-08-14T08:00:00Z','2026-08-15T02:00:00Z'),
         ($3,$4,'Security Event Two','Africa/Nairobi','ACTIVE','2026-08-14T08:00:00Z','2026-08-15T02:00:00Z')`,
      [eventOne, orgOne, eventTwo, orgTwo],
    );
    await database.query(
      `INSERT INTO sales_locations(id,organisation_id,event_id,name,type)
       VALUES ($1,$2,$3,'Bar One','BAR'),($4,$5,$6,'Bar Two','BAR')`,
      [locationOne, orgOne, eventOne, locationTwo, orgTwo, eventTwo],
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  it('derives authority from revocable credentials and keeps raw secrets out of persistence', async () => {
    await request(app.getHttpServer())
      .get('/sync/devices')
      .set({
        'x-actor-id': bootstrapActor,
        'x-role': 'PLATFORM_ADMIN',
        'x-organisation-id': orgOne,
      })
      .expect(401);

    await request(app.getHttpServer())
      .post('/security/bootstrap/operator')
      .send({
        organisationId: orgOne,
        actorId: bootstrapActor,
        label: 'bootstrap admin',
      })
      .expect(401);

    const bootstrap = await request(app.getHttpServer())
      .post('/security/bootstrap/operator')
      .set('x-security-bootstrap-secret', process.env.SECURITY_BOOTSTRAP_SECRET!)
      .send({
        organisationId: orgOne,
        actorId: bootstrapActor,
        label: 'bootstrap admin',
      })
      .expect(201);
    const bootstrapToken = bootstrap.body.token as string;
    const bootstrapCredentialId = bootstrap.body.credentialId as string;
    expect(bootstrapToken).toContain(`${bootstrapCredentialId}.`);

    await request(app.getHttpServer())
      .post('/security/bootstrap/operator')
      .set('x-security-bootstrap-secret', process.env.SECURITY_BOOTSTRAP_SECRET!)
      .send({
        organisationId: orgOne,
        actorId: bootstrapActor,
        label: 'second bootstrap must fail',
      })
      .expect(409);

    const storedBootstrap = await database.query<{ secret_hash: string }>(
      `SELECT secret_hash FROM security_operator_credentials WHERE id=$1`,
      [bootstrapCredentialId],
    );
    expect(storedBootstrap[0]?.secret_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(storedBootstrap[0]?.secret_hash).not.toContain(bootstrapToken);

    const second = await request(app.getHttpServer())
      .post('/security/operators')
      .set(bearer(bootstrapToken))
      .send({
        organisationId: orgOne,
        actorId: secondActor,
        role: 'ADMIN',
        label: 'event admin',
      })
      .expect(201);
    const operatorToken = second.body.token as string;

    await request(app.getHttpServer())
      .get('/sync/devices')
      .set(bearer(operatorToken))
      .expect(200);

    await request(app.getHttpServer())
      .post(`/security/events/${eventTwo}/devices`)
      .set(bearer(operatorToken, orgTwo))
      .send({
        deviceId: 'forbidden-device',
        salesLocationId: locationTwo,
        label: 'cross tenant',
      })
      .expect(403);

    const device = await request(app.getHttpServer())
      .post(`/security/events/${eventOne}/devices`)
      .set(bearer(operatorToken))
      .send({
        deviceId: 'pos-bar-one-01',
        salesLocationId: locationOne,
        label: 'Bar One POS 01',
      })
      .expect(201);
    const deviceToken = device.body.token as string;
    const deviceCredentialId = device.body.credentialId as string;

    const edge = await request(app.getHttpServer())
      .post(`/security/events/${eventOne}/edges`)
      .set(bearer(operatorToken))
      .send({ edgeId: 'edge-security-test', label: 'Pilot Edge' })
      .expect(201);
    const edgeToken = edge.body.token as string;

    const snapshot = await request(app.getHttpServer())
      .get(`/security/events/${eventOne}/edge-snapshot`)
      .set(bearer(operatorToken))
      .expect(200);
    expect(snapshot.body.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshot.body.snapshot.eventId).toBe(eventOne);
    expect(snapshot.body.snapshot.devices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          credentialId: deviceCredentialId,
          deviceId: 'pos-bar-one-01',
          eventId: eventOne,
        }),
      ]),
    );
    expect(JSON.stringify(snapshot.body)).not.toContain(deviceToken);
    expect(JSON.stringify(snapshot.body)).not.toContain(edgeToken);

    await request(app.getHttpServer())
      .post('/sync/edge-events')
      .set('Authorization', `Edge ${edgeToken}`)
      .send(validEdgeBatch('another-edge'))
      .expect(403);

    await request(app.getHttpServer())
      .post('/sync/edge-events')
      .set('Authorization', `Edge ${edgeToken}`)
      .send(validEdgeBatch('edge-security-test', eventTwo))
      .expect(403);

    await request(app.getHttpServer())
      .post('/sync/edge-events')
      .send(validEdgeBatch('edge-security-test'))
      .expect(401);

    const providerCallback = await request(app.getHttpServer())
      .post('/payments/providers/mpesa/callback')
      .send({});
    expect(providerCallback.status).not.toBe(401);

    await request(app.getHttpServer())
      .post(`/security/credentials/device/${deviceCredentialId}/revoke`)
      .set(bearer(operatorToken))
      .send({ reason: 'device removed from pilot' })
      .expect(201);

    const afterRevocation = await request(app.getHttpServer())
      .get(`/security/events/${eventOne}/edge-snapshot`)
      .set(bearer(operatorToken))
      .expect(200);
    expect(
      (afterRevocation.body.snapshot.devices as Array<{ credentialId: string }>).some(
        (item) => item.credentialId === deviceCredentialId,
      ),
    ).toBe(false);

    const audit = await database.query<{ actor_id: string; changes: string }>(
      `SELECT actor_id::text,changes::text FROM audit_events
       WHERE entity_type LIKE 'SECURITY_%' AND organisation_id=$1`,
      [orgOne],
    );
    expect(audit.some((row) => row.actor_id === secondActor)).toBe(true);
    const auditText = JSON.stringify(audit);
    expect(auditText).not.toContain(bootstrapToken);
    expect(auditText).not.toContain(operatorToken);
    expect(auditText).not.toContain(deviceToken);
    expect(auditText).not.toContain(edgeToken);

    await request(app.getHttpServer())
      .post(`/security/credentials/operator/${second.body.credentialId}/revoke`)
      .set(bearer(operatorToken))
      .send({ reason: 'self revoke test' })
      .expect(201);

    await request(app.getHttpServer())
      .get('/sync/devices')
      .set(bearer(operatorToken))
      .expect(401);
  });
});
