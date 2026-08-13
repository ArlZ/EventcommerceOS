import { describe, expect, it } from 'vitest';
import type { LogContext } from '../src';

describe('observability contracts', () => {
  it('supports correlation context without business dependencies', () => {
    const context: LogContext = { correlationId: 'corr-1', deviceId: 'device-1' };
    expect(context.correlationId).toBe('corr-1');
  });
});
