import { Test } from '@nestjs/testing';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';

describe('cloud-api health', () => {
  it('serves health with the configured exact release identity after database readiness', async () => {
    const releaseCommit = '0123456789abcdef0123456789abcdef01234567';
    const previousReleaseCommit = process.env.RELEASE_COMMIT;
    process.env.RELEASE_COMMIT = releaseCommit;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();

    try {
      await app.init();
      const response = await request(app.getHttpServer()).get('/health').expect(200);
      expect(response.body.service).toBe('cloud-api');
      expect(response.body.status).toBe('ok');
      expect(response.body.releaseCommit).toBe(releaseCommit);
    } finally {
      await app.close();
      if (previousReleaseCommit === undefined) {
        delete process.env.RELEASE_COMMIT;
      } else {
        process.env.RELEASE_COMMIT = previousReleaseCommit;
      }
    }
  });

  it('returns 503 when the database migration ledger is stale', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService)
      .useValue({
        query: async () => [],
      })
      .compile();
    const app = moduleRef.createNestApplication();

    try {
      await app.init();
      const response = await request(app.getHttpServer()).get('/health').expect(503);
      expect(response.body.message).toBe('service not ready');
    } finally {
      await app.close();
    }
  });

  it('returns 503 without leaking database errors when the database is unavailable', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService)
      .useValue({
        query: async () => {
          throw new Error('postgresql://user:secret-password@database.internal:5432/private');
        },
      })
      .compile();
    const app = moduleRef.createNestApplication();

    try {
      await app.init();
      const response = await request(app.getHttpServer()).get('/health').expect(503);
      expect(response.body.message).toBe('service not ready');
      expect(JSON.stringify(response.body)).not.toContain('secret-password');
      expect(JSON.stringify(response.body)).not.toContain('database.internal');
    } finally {
      await app.close();
    }
  });
});
