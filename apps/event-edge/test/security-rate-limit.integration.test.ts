import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { EdgeDatabaseService } from '../src/database/database.service';

const describeIntegration =
  process.env.EDGE_DATABASE_URL || process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration('Event Edge pilot abuse control', () => {
  let app: INestApplication;
  let database: EdgeDatabaseService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    database = moduleRef.get(EdgeDatabaseService);
  });

  beforeEach(() => {
    process.env.SECURITY_TEST_BYPASS = 'false';
    process.env.SECURITY_TEST_RATE_LIMIT_PER_MINUTE = '2';
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns 429 without changing installed security snapshot state', async () => {
    const before = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM edge_security_snapshot_state`,
    );

    await request(app.getHttpServer()).get('/health').expect(200);
    await request(app.getHttpServer()).get('/health').expect(200);
    await request(app.getHttpServer()).get('/health').expect(429);

    const after = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM edge_security_snapshot_state`,
    );
    expect(after[0]?.count).toBe(before[0]?.count);
  });
});
