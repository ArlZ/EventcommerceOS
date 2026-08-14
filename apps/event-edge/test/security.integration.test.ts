import 'reflect-metadata';
import { createHmac } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  canonicalSecurityJson,
  issueOpaqueCredential,
} from '@event-commerce/domain';
import type {
  EdgeSecuritySnapshot,
  SignedEdgeSecuritySnapshot,
} from '@event-commerce/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { EdgeDatabaseService } from '../src/database/database.service';

process.env.SECURITY_TEST_BYPASS = 'false';
process.env.EDGE_SECURITY_SNAPSHOT_SECRET =
  'task011-edge-security-snapshot-signing-secret-for-tests';

const describeIntegration =
  process.env.EDGE_DATABASE_URL || process.env.DATABASE_URL ? describe : describe.skip;
const organisationId = '51000000-0000-4100-8100-000000000001';
const eventId = '52000000-0000-4200-8200-000000000001';
const otherEventId = '52000000-0000-4200-8200-000000000002';
const salesLocationId = '53000000-0000-4300-8300-000000000001';
const actorId = '54000000-0000-4400-8400-000000000001';

function signed(snapshot: EdgeSecuritySnapshot): SignedEdgeSecuritySnapshot {
  return {
    snapshot,
    signature: createHmac('sha256', process.env.EDGE_SECURITY_SNAPSHOT_SECRET!)
      .update(canonicalSecurityJson(snapshot))
      .digest('hex'),
  };
}

function deviceBatch(deviceId: string, businessEventId = eventId) {
  return {
    deviceId,
    events: [
      {
        schemaVersion: 1,
        eventInstanceId: `instance-${deviceId}`,
        eventId: `event-envelope-${deviceId}`,
        eventType: 'SECURITY_TEST',
        aggregateType: 'SECURITY_TEST',
        aggregateId: `aggregate-${deviceId}`,
        eventVersion: 1,
        deviceId,
        sequence: 1,
        occurredAt: '2026-08-14T12:00:00.000Z',
        idempotencyKey: `security-${deviceId}`,
        payload: { eventId: businessEventId, salesLocationId },
      },
    ],
  };
}

describeIntegration('Event Edge signed security snapshot and offline authentication', () => {
  let app: INestApplication;
  let database: EdgeDatabaseService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    database = moduleRef.get(EdgeDatabaseService);
  });

  beforeEach(async () => {
    process.env.SECURITY_TEST_BYPASS = 'false';
    await database.query(`DELETE FROM edge_security_operator_credentials`);
    await database.query(`DELETE FROM edge_security_device_credentials`);
    await database.query(`DELETE FROM edge_security_snapshot_state`);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('authenticates locally, rejects tampering/scope abuse, and applies revocation snapshot', async () => {
    const operator = issueOpaqueCredential();
    const device = issueOpaqueCredential();
    const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
    const snapshotOne: EdgeSecuritySnapshot = {
      schemaVersion: 1,
      version: 1,
      generatedAt: new Date().toISOString(),
      organisationId,
      eventId,
      operators: [
        {
          credentialId: operator.credentialId,
          actorId,
          organisationId,
          role: 'ADMIN',
          secretHash: operator.secretHash,
          expiresAt,
        },
      ],
      devices: [
        {
          credentialId: device.credentialId,
          organisationId,
          eventId,
          salesLocationId,
          deviceId: 'pos-security-01',
          secretHash: device.secretHash,
          expiresAt,
        },
      ],
    };

    const tampered = signed(snapshotOne);
    tampered.snapshot = { ...tampered.snapshot, version: 2 };
    await request(app.getHttpServer())
      .post('/security/snapshot')
      .send(tampered)
      .expect(401);

    await request(app.getHttpServer())
      .post('/security/snapshot')
      .send(signed(snapshotOne))
      .expect(201);

    await request(app.getHttpServer()).get('/security/status').expect(401);

    const status = await request(app.getHttpServer())
      .get('/security/status')
      .set('Authorization', `Bearer ${operator.token}`)
      .expect(200);
    expect(status.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventId, organisationId, version: 1 }),
      ]),
    );

    await request(app.getHttpServer())
      .post('/security/snapshot')
      .send(signed(snapshotOne))
      .expect(409);

    await request(app.getHttpServer())
      .post('/sync/device-events')
      .send(deviceBatch('pos-security-01'))
      .expect(401);

    await request(app.getHttpServer())
      .post('/sync/device-events')
      .set('Authorization', `Device ${device.token}`)
      .send(deviceBatch('another-device'))
      .expect(403);

    await request(app.getHttpServer())
      .post('/sync/device-events')
      .set('Authorization', `Device ${device.token}`)
      .send(deviceBatch('pos-security-01', otherEventId))
      .expect(403);

    await request(app.getHttpServer())
      .get(`/inventory/events/${otherEventId}/stock`)
      .set('Authorization', `Bearer ${operator.token}`)
      .expect(403);

    await request(app.getHttpServer())
      .post('/sync/device-events')
      .set('Authorization', `Device ${device.token}`)
      .send(deviceBatch('pos-security-01'))
      .expect(201);

    const snapshotTwo: EdgeSecuritySnapshot = {
      ...snapshotOne,
      version: 2,
      generatedAt: new Date(Date.now() + 1_000).toISOString(),
      devices: [],
    };
    await request(app.getHttpServer())
      .post('/security/snapshot')
      .send(signed(snapshotTwo))
      .expect(201);

    await request(app.getHttpServer())
      .post('/sync/device-events')
      .set('Authorization', `Device ${device.token}`)
      .send(deviceBatch('pos-security-01'))
      .expect(401);

    await request(app.getHttpServer())
      .get('/security/status')
      .set('Authorization', `Bearer ${operator.token}`)
      .expect(200)
      .expect((response) => {
        expect(response.body[0]?.version).toBe(2);
      });
  });
});
