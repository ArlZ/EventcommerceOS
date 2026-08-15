import { Test } from '@nestjs/testing';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';

describe('cloud-api health', () => {
  it('serves health with the configured exact release identity', async () => {
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
});
