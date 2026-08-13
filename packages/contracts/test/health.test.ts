import { describe, expect, it } from 'vitest';
import { makeHealthResponse } from '../src';

describe('health contract', () => {
  it('creates a stable health payload', () => {
    const response = makeHealthResponse('test-service', new Date('2026-01-01T00:00:00.000Z'));
    expect(response).toEqual({service:'test-service',status:'ok',version:'0.1.0',timestamp:'2026-01-01T00:00:00.000Z'});
  });
});
