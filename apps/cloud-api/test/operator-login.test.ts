import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { OperatorAuthService } from '../src/auth/operator-auth.service';
import {
  cookieValue,
  operatorLoginCookie,
  operatorSessionCookie,
} from '../src/auth/operator-cookie';
import {
  loginEmail,
  maskOperatorEmail,
  OperatorLoginService,
} from '../src/auth/operator-login.service';
import { classifyAbuseRequest } from '../src/security/abuse-protection.guard';

const actorId = '11111111-1111-4111-8111-111111111111';
const supabaseUserId = '22222222-2222-4222-8222-222222222222';
const email = 'operator@example.com';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

describe('operator browser authentication', () => {
  it('normalizes email and masks it for the verification screen', () => {
    expect(loginEmail(' Operator@Example.COM ')).toBe(email);
    expect(maskOperatorEmail(email)).toBe('o•••@example.com');
  });

  it('serializes HttpOnly production cookies without exposing a domain-wide credential', () => {
    const production = { NODE_ENV: 'production' } as NodeJS.ProcessEnv;
    const session = operatorSessionCookie(`ecom_op_${'a'.repeat(50)}`, true, production);
    expect(session).toContain('HttpOnly');
    expect(session).toContain('SameSite=Strict');
    expect(session).toContain('Secure');
    expect(session).toContain('Max-Age=2592000');
    expect(session).not.toContain('Domain=');

    const login = operatorLoginCookie(`ecom_login_${'b'.repeat(50)}`, production);
    expect(cookieValue({ cookie: `other=x; ${login.split(';', 1)[0]}` }, 'ec_operator_login')).toBe(
      `ecom_login_${'b'.repeat(50)}`,
    );
  });

  it('accepts operator sessions from the HttpOnly cookie and hashes the credential before lookup', async () => {
    const token = `ecom_op_${'c'.repeat(50)}`;
    const database = {
      query: vi
        .fn()
        .mockResolvedValue([{ session_id: 'session-1', actor_id: actorId, platform_role: null }]),
    };
    const service = new OperatorAuthService(database as never);

    expect(service.isOperatorAuthorization({ cookie: `ec_operator_session=${token}` })).toBe(true);
    await expect(service.authenticate({ cookie: `ec_operator_session=${token}` })).resolves.toEqual(
      {
        sessionId: 'session-1',
        actorId,
        platformAdmin: false,
      },
    );
    expect(database.query).toHaveBeenCalledWith(expect.any(String), [sha256(token)]);
  });

  it('starts verification only for the active operator mapped by verified email', async () => {
    const queries: Array<{ text: string; values: readonly unknown[] }> = [];
    const database = {
      query: vi.fn(async (text: string, values: readonly unknown[]) => {
        queries.push({ text, values });
        if (text.includes('FROM operator_identities')) {
          return [{ id: actorId, email, supabase_user_id: null }];
        }
        return [];
      }),
    };
    const supabase = {
      passwordSignIn: vi
        .fn()
        .mockResolvedValue({ userId: supabaseUserId, email, accessToken: 'supa-a' }),
      sendEmailOtp: vi.fn().mockResolvedValue(undefined),
      signOut: vi.fn().mockResolvedValue(undefined),
    };
    const service = new OperatorLoginService(database as never, supabase as never);

    const result = await service.begin({
      email,
      password: 'correct-password',
      rememberDevice: true,
    });
    expect(result.challengeToken).toMatch(/^ecom_login_/);
    expect(result.maskedEmail).toBe('o•••@example.com');
    expect(supabase.sendEmailOtp).toHaveBeenCalledWith(email);
    expect(supabase.signOut).toHaveBeenCalledWith('supa-a');

    const insert = queries.find((query) =>
      query.text.includes('INSERT INTO operator_login_challenges'),
    );
    expect(insert).toBeDefined();
    expect(insert?.values[4]).toMatch(/^[0-9a-f]{64}$/);
    expect(insert?.values).not.toContain(result.challengeToken);
  });

  it('keeps database failure distinct from an incorrect password', async () => {
    const databaseError = new Error('database offline');
    const database = { query: vi.fn().mockRejectedValue(databaseError) };
    const supabase = {
      passwordSignIn: vi
        .fn()
        .mockResolvedValue({ userId: supabaseUserId, email, accessToken: 'supa-b' }),
      signOut: vi.fn().mockResolvedValue(undefined),
    };
    const service = new OperatorLoginService(database as never, supabase as never);

    await expect(service.begin({ email, password: 'correct-password' })).rejects.toBe(
      databaseError,
    );
    expect(supabase.signOut).toHaveBeenCalledWith('supa-b');
  });

  it('does not send an OTP for an email that is not an active operator identity', async () => {
    const database = { query: vi.fn().mockResolvedValue([]) };
    const supabase = {
      passwordSignIn: vi
        .fn()
        .mockResolvedValue({ userId: supabaseUserId, email, accessToken: 'supa-c' }),
      sendEmailOtp: vi.fn(),
      signOut: vi.fn().mockResolvedValue(undefined),
    };
    const service = new OperatorLoginService(database as never, supabase as never);

    await expect(service.begin({ email, password: 'correct-password' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(supabase.sendEmailOtp).not.toHaveBeenCalled();
    expect(supabase.signOut).toHaveBeenCalledWith('supa-c');
  });

  it('gives login traffic its own strict abuse policy and recognizes cookie sessions', () => {
    expect(
      classifyAbuseRequest({
        method: 'POST',
        path: '/operator-auth/login/password',
        headers: {},
      })?.policy,
    ).toBe('OPERATOR_LOGIN');

    expect(
      classifyAbuseRequest({
        method: 'GET',
        path: '/command-centre',
        headers: { cookie: `ec_operator_session=ecom_op_${'d'.repeat(50)}` },
      })?.policy,
    ).toBe('OPERATOR_READ');
  });
});
