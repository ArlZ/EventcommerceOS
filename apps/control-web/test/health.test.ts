import { describe, expect, it } from 'vitest';
import { GET } from '../src/app/api/health/route';

describe('control-web health', () => {
  it('returns the health contract', async () => {
    const response = GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.service).toBe('control-web');
    expect(body.status).toBe('ok');
  });
});
