import { describe, expect, it } from 'vitest';
import { isPublicControlRoute, normalizeControlPathname } from '../src/app/public-route';

describe('Event Control public route detection', () => {
  it('treats static-export trailing slash sign-in as public', () => {
    expect(isPublicControlRoute('/sign-in/')).toBe(true);
  });

  it('keeps the canonical sign-in route public', () => {
    expect(isPublicControlRoute('/sign-in')).toBe(true);
  });

  it('does not make nested or protected routes public', () => {
    expect(isPublicControlRoute('/sign-in/help')).toBe(false);
    expect(isPublicControlRoute('/')).toBe(false);
    expect(isPublicControlRoute('/inventory/')).toBe(false);
  });

  it('normalizes only trailing separators', () => {
    expect(normalizeControlPathname('/sign-in///')).toBe('/sign-in');
    expect(normalizeControlPathname('/')).toBe('/');
  });
});
