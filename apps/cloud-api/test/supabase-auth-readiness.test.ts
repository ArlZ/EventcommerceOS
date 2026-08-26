import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  classifySupabaseNetworkFailure,
  supabaseAuthBaseUrl,
  supabasePublishableKey,
  SupabaseAuthTransport,
} from '../src/auth/supabase-auth.transport';

describe('Supabase Auth readiness diagnostics', () => {
  it('requires an HTTPS Auth URL in production and a publishable key', () => {
    expect(() => supabaseAuthBaseUrl({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(
      ServiceUnavailableException,
    );
    expect(() =>
      supabaseAuthBaseUrl({
        NODE_ENV: 'production',
        SUPABASE_AUTH_URL: 'http://example.invalid',
      } as NodeJS.ProcessEnv),
    ).toThrow(ServiceUnavailableException);
    expect(
      supabaseAuthBaseUrl({
        NODE_ENV: 'production',
        SUPABASE_AUTH_URL: 'https://project.supabase.co/',
      } as NodeJS.ProcessEnv),
    ).toBe('https://project.supabase.co');

    expect(() => supabasePublishableKey({} as NodeJS.ProcessEnv)).toThrow(
      ServiceUnavailableException,
    );
    expect(
      supabasePublishableKey({ SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example_value' } as NodeJS.ProcessEnv),
    ).toBe('sb_publishable_example_value');
  });

  it('classifies DNS, TLS, timeout, and connection errors without exposing secrets', () => {
    expect(classifySupabaseNetworkFailure({ cause: { code: 'ENOTFOUND' } })).toEqual({
      failure: 'dns',
      networkCode: 'ENOTFOUND',
    });
    expect(classifySupabaseNetworkFailure({ cause: { code: 'CERT_HAS_EXPIRED' } })).toEqual({
      failure: 'tls',
      networkCode: 'CERT_HAS_EXPIRED',
    });
    expect(classifySupabaseNetworkFailure({ name: 'TimeoutError', code: 'ETIMEDOUT' })).toEqual({
      failure: 'timeout',
      networkCode: 'ETIMEDOUT',
    });
    expect(classifySupabaseNetworkFailure({ cause: { code: 'ENETUNREACH' } })).toEqual({
      failure: 'connection',
      networkCode: 'ENETUNREACH',
    });
  });

  it('reports configuration failure before attempting a network probe', async () => {
    const originalAuthUrl = process.env.SUPABASE_AUTH_URL;
    const originalUrl = process.env.SUPABASE_URL;
    const originalPublishable = process.env.SUPABASE_PUBLISHABLE_KEY;
    const originalAnon = process.env.SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_AUTH_URL;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    delete process.env.SUPABASE_ANON_KEY;

    try {
      const probe = await new SupabaseAuthTransport().dependencyProbe();
      expect(probe).toMatchObject({
        dependency: 'operator-auth',
        status: 'unavailable',
        configured: false,
        failure: 'configuration',
        httpStatus: null,
        networkCode: null,
      });
    } finally {
      if (originalAuthUrl === undefined) delete process.env.SUPABASE_AUTH_URL;
      else process.env.SUPABASE_AUTH_URL = originalAuthUrl;
      if (originalUrl === undefined) delete process.env.SUPABASE_URL;
      else process.env.SUPABASE_URL = originalUrl;
      if (originalPublishable === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY;
      else process.env.SUPABASE_PUBLISHABLE_KEY = originalPublishable;
      if (originalAnon === undefined) delete process.env.SUPABASE_ANON_KEY;
      else process.env.SUPABASE_ANON_KEY = originalAnon;
    }
  });
});
