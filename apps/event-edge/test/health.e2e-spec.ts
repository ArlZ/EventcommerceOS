import { Test } from '@nestjs/testing';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';

describe('event-edge health', () => {
  it('serves a healthy system response', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    const response = await request(app.getHttpServer()).get('/health').expect(200);
    expect(response.body.service).toBe('event-edge');
    expect(response.body.status).toBe('ok');
    await app.close();
  });
});
