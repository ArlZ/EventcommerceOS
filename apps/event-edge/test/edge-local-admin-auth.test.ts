import { afterEach, describe, expect, it } from 'vitest';
import { EdgeLocalAdminAuthService } from '../src/security/edge-local-admin-auth.service';

const originalNodeEnv = process.env.NODE_ENV;
const originalToken = process.env.EDGE_LOCAL_ADMIN_TOKEN;

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;

  if (originalToken === undefined) delete process.env.EDGE_LOCAL_ADMIN_TOKEN;
  else process.env.EDGE_LOCAL_ADMIN_TOKEN = originalToken;
});

describe('EdgeLocalAdminAuthService', () => {
  it('allows unconfigured local development', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.EDGE_LOCAL_ADMIN_TOKEN;
    const service = new EdgeLocalAdminAuthService();
    expect(() => service.authorize({})).not.toThrow();
  });

  it('fails closed in production when local admin auth is not configured', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.EDGE_LOCAL_ADMIN_TOKEN;
    const service = new EdgeLocalAdminAuthService();
    expect(() => service.authorize({})).toThrow('Event Edge local admin access is not configured');
  });

  it('accepts the configured bearer credential', () => {
    process.env.NODE_ENV = 'production';
    process.env.EDGE_LOCAL_ADMIN_TOKEN = '0123456789abcdef0123456789abcdef';
    const service = new EdgeLocalAdminAuthService();
    expect(() =>
      service.authorize({ authorization: `Bearer ${process.env.EDGE_LOCAL_ADMIN_TOKEN}` }),
    ).not.toThrow();
  });

  it('rejects an incorrect bearer credential', () => {
    process.env.NODE_ENV = 'production';
    process.env.EDGE_LOCAL_ADMIN_TOKEN = '0123456789abcdef0123456789abcdef';
    const service = new EdgeLocalAdminAuthService();
    expect(() =>
      service.authorize({ authorization: 'Bearer ffffffffffffffffffffffffffffffff' }),
    ).toThrow('Invalid Event Edge local admin credential');
  });
});
