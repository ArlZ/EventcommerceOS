import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, it } from 'vitest';
import type { OrganisationRecord } from '@event-commerce/contracts';
import { AppModule } from '../src/app.module';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration('event timestamp boundary', () => {
  let app: INestApplication;
  const actorId = randomUUID();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects an event timestamp without Z or an explicit numeric offset', async () => {
    const organisation = (
      await request(app.getHttpServer())
        .post('/organisations')
        .set({ 'x-actor-id': actorId, 'x-role': 'ADMIN' })
        .send({ name: 'Timestamp Boundary Operator' })
        .expect(201)
    ).body as OrganisationRecord;

    await request(app.getHttpServer())
      .post('/events')
      .set({
        'x-actor-id': actorId,
        'x-role': 'ADMIN',
        'x-organisation-id': organisation.id,
      })
      .send({
        organisationId: organisation.id,
        name: 'Offsetless Timestamp Event',
        timezone: 'Africa/Nairobi',
        startsAt: '2026-09-01T18:00:00',
        endsAt: '2026-09-02T02:00:00+03:00',
      })
      .expect(400);
  });
});
