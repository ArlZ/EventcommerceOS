import { describe, expect, it } from 'vitest';
import { canEditEventConfiguration } from '../src/app/configuration/event-configuration';

describe('event configuration lifecycle guard', () => {
  it('allows event-scoped setup while the event is DRAFT', () => {
    expect(canEditEventConfiguration('DRAFT')).toBe(true);
  });

  it.each(['ACTIVE', 'CLOSED', 'ARCHIVED'])('keeps %s event setup read only', (lifecycle) => {
    expect(canEditEventConfiguration(lifecycle)).toBe(false);
  });

  it('fails closed when no event lifecycle is available', () => {
    expect(canEditEventConfiguration(null)).toBe(false);
    expect(canEditEventConfiguration(undefined)).toBe(false);
  });
});
