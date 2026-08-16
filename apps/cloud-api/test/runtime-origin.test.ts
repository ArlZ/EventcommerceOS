import { describe, expect, it } from 'vitest';
import { controlWebOrigin } from '../src/system/runtime-origin';

describe('Control Web origin configuration', () => {
  it('retains the localhost fallback outside production', () => {
    expect(controlWebOrigin({ NODE_ENV: 'test' })).toBe('http://localhost:3000');
  });

  it('requires an explicit origin in production', () => {
    expect(() => controlWebOrigin({ NODE_ENV: 'production' })).toThrow(
      /CONTROL_WEB_ORIGIN is required in production/,
    );
  });

  it('accepts and canonicalizes an explicit HTTPS production origin', () => {
    expect(
      controlWebOrigin({
        NODE_ENV: 'production',
        CONTROL_WEB_ORIGIN: '  https://control.example.test:8443  ',
      }),
    ).toBe('https://control.example.test:8443');
  });

  it.each([
    'http://control.example.test',
    'https://user:secret@control.example.test',
    'https://control.example.test/path',
    'https://control.example.test?token=x',
    'https://control.example.test#fragment',
    'not-a-url',
  ])('rejects unsafe or ambiguous production origin %s', (origin) => {
    expect(() =>
      controlWebOrigin({ NODE_ENV: 'production', CONTROL_WEB_ORIGIN: origin }),
    ).toThrow(/CONTROL_WEB_ORIGIN/);
  });

  it('allows an explicit HTTP origin outside production for local development', () => {
    expect(
      controlWebOrigin({
        NODE_ENV: 'development',
        CONTROL_WEB_ORIGIN: 'http://127.0.0.1:3000',
      }),
    ).toBe('http://127.0.0.1:3000');
  });
});
