import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration('Cloud pilot abuse control', () => {
  let app: INestApplication;
  let database: DatabaseService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    database = moduleRef.get(DatabaseService);
  });

  beforeEach(() => {
    process.env.SECURITY_TEST_BYPASS = 'false';
    process.env.SECURITY_TEST_RATE_LIMIT_PER_MINUTE = '2';
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns 429 without creating or mutating credential domain state', async () => {
    const before = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM security_operator_credentials`,
    );

    await request(app.getHttpServer()).get('/health').expect(200);
    await request(app.getHttpServer()).get('/health').expect(200);
    await request(app.getHttpServer()).get('/health').expect(429);

    const after = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM security_operator_credentials`,
    );
    expect(after[0]?.count).toBe(before[0]?.count);
  });
});
