import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, it } from 'vitest';
import type { OrganisationRecord } from '@event-commerce/contracts';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { provisionOperator } from './operator-auth-testkit';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration('event timestamp boundary', () => {
  let app: INestApplication;
  let platformHeaders: (organisationId?: string) => Record<string, string>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    const database = moduleRef.get(DatabaseService);
    await app.init();
    const platform = await provisionOperator(database, {
      actorId: randomUUID(),
      platformAdmin: true,
    });
    platformHeaders = platform.headers;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects an event timestamp without Z or an explicit numeric offset', async () => {
    const organisation = (
      await request(app.getHttpServer())
        .post('/organisations')
        .set(platformHeaders())
        .send({ name: 'Timestamp Boundary Operator' })
        .expect(201)
    ).body as OrganisationRecord;

    await request(app.getHttpServer())
      .post('/events')
      .set(platformHeaders(organisation.id))
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
