import {
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { lookup } from 'node:dns/promises';

export interface SupabaseAuthProof {
  userId: string;
  email: string;
  accessToken: string;
}

export type SupabaseAuthFailureKind =
  | 'configuration'
  | 'dns'
  | 'timeout'
  | 'tls'
  | 'connection'
  | 'http_5xx'
  | 'unknown';

export interface SupabaseAuthDependencyProbe {
  dependency: 'operator-auth';
  status: 'ok' | 'unavailable';
  configured: boolean;
  host: string | null;
  dns: {
    ipv4: boolean;
    ipv6: boolean;
  };
  httpStatus: number | null;
  failure: SupabaseAuthFailureKind | null;
  networkCode: string | null;
  elapsedMs: number;
}

interface SupabaseAuthResponse {
  access_token?: unknown;
  user?: {
    id?: unknown;
    email?: unknown;
  } | null;
}

export function supabaseAuthBaseUrl(environment: NodeJS.ProcessEnv = process.env): string {
  const raw = (environment.SUPABASE_AUTH_URL ?? environment.SUPABASE_URL)?.trim();
  if (!raw) throw new ServiceUnavailableException('Operator identity provider is not configured');
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ServiceUnavailableException('Operator identity provider URL is invalid');
  }
  if (environment.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new ServiceUnavailableException('Operator identity provider must use HTTPS');
  }
  return parsed.toString().replace(/\/$/, '');
}

export function supabasePublishableKey(environment: NodeJS.ProcessEnv = process.env): string {
  const value = (environment.SUPABASE_PUBLISHABLE_KEY ?? environment.SUPABASE_ANON_KEY)?.trim();
  if (!value || value.length < 20) {
    throw new ServiceUnavailableException('Operator identity provider key is not configured');
  }
  return value;
}

function authProof(value: unknown): SupabaseAuthProof {
  if (typeof value !== 'object' || value === null) {
    throw new UnauthorizedException(
      'Identity provider returned an invalid authentication response',
    );
  }
  const response = value as SupabaseAuthResponse;
  const userId = response.user?.id;
  const email = response.user?.email;
  const accessToken = response.access_token;
  if (
    typeof userId !== 'string' ||
    !userId.trim() ||
    typeof email !== 'string' ||
    !email.trim() ||
    typeof accessToken !== 'string' ||
    !accessToken.trim()
  ) {
    throw new UnauthorizedException('Identity provider did not return a verified user session');
  }
  return {
    userId: userId.trim(),
    email: email.trim().toLowerCase(),
    accessToken: accessToken.trim(),
  };
}

function errorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === 'string' && direct) return direct;
  const cause = (error as { cause?: unknown }).cause;
  if (typeof cause !== 'object' || cause === null) return null;
  const nested = (cause as { code?: unknown }).code;
  return typeof nested === 'string' && nested ? nested : null;
}

export function classifySupabaseNetworkFailure(error: unknown): {
  failure: Exclude<SupabaseAuthFailureKind, 'configuration' | 'http_5xx'>;
  networkCode: string | null;
} {
  const code = errorCode(error);
  const name = error instanceof Error ? error.name : '';
  if (name === 'TimeoutError' || name === 'AbortError' || code === 'ETIMEDOUT') {
    return { failure: 'timeout', networkCode: code };
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return { failure: 'dns', networkCode: code };
  }
  if (
    code?.startsWith('CERT_') ||
    code?.startsWith('ERR_TLS_') ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
  ) {
    return { failure: 'tls', networkCode: code };
  }
  if (
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH' ||
    code === 'EPIPE'
  ) {
    return { failure: 'connection', networkCode: code };
  }
  return { failure: 'unknown', networkCode: code };
}

@Injectable()
export class SupabaseAuthTransport {
  async passwordSignIn(email: string, password: string): Promise<SupabaseAuthProof> {
    return authProof(
      await this.request('/auth/v1/token?grant_type=password', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    );
  }

  async sendEmailOtp(email: string): Promise<void> {
    await this.request('/auth/v1/otp', {
      method: 'POST',
      body: JSON.stringify({ email, create_user: false }),
    });
  }

  async verifyEmailOtp(email: string, token: string): Promise<SupabaseAuthProof> {
    return authProof(
      await this.request('/auth/v1/verify', {
        method: 'POST',
        body: JSON.stringify({ email, token, type: 'email' }),
      }),
    );
  }

  async signOut(accessToken: string): Promise<void> {
    try {
      await this.request('/auth/v1/logout', {
        method: 'POST',
        authorization: `Bearer ${accessToken}`,
      });
    } catch {
      // Event Control does not retain the Supabase session. Its operator session is separate,
      // so best-effort upstream sign-out must not turn a successful proof into a login failure.
    }
  }

  async dependencyProbe(): Promise<SupabaseAuthDependencyProbe> {
    const startedAt = Date.now();
    let authUrl: string;
    let key: string;
    try {
      authUrl = supabaseAuthBaseUrl();
      key = supabasePublishableKey();
    } catch {
      return {
        dependency: 'operator-auth',
        status: 'unavailable',
        configured: false,
        host: null,
        dns: { ipv4: false, ipv6: false },
        httpStatus: null,
        failure: 'configuration',
        networkCode: null,
        elapsedMs: Date.now() - startedAt,
      };
    }

    const host = new URL(authUrl).hostname;
    let ipv4 = false;
    let ipv6 = false;
    try {
      const addresses = await lookup(host, { all: true });
      ipv4 = addresses.some((entry) => entry.family === 4);
      ipv6 = addresses.some((entry) => entry.family === 6);
    } catch (error) {
      const classified = classifySupabaseNetworkFailure(error);
      return {
        dependency: 'operator-auth',
        status: 'unavailable',
        configured: true,
        host,
        dns: { ipv4: false, ipv6: false },
        httpStatus: null,
        failure: classified.failure === 'unknown' ? 'dns' : classified.failure,
        networkCode: classified.networkCode,
        elapsedMs: Date.now() - startedAt,
      };
    }

    let response: Response;
    try {
      response = await fetch(`${authUrl}/auth/v1/settings`, {
        method: 'GET',
        headers: { apikey: key, accept: 'application/json' },
        signal: AbortSignal.timeout(5_000),
      });
    } catch (error) {
      const classified = classifySupabaseNetworkFailure(error);
      return {
        dependency: 'operator-auth',
        status: 'unavailable',
        configured: true,
        host,
        dns: { ipv4, ipv6 },
        httpStatus: null,
        failure: classified.failure,
        networkCode: classified.networkCode,
        elapsedMs: Date.now() - startedAt,
      };
    }

    if (response.status >= 500) {
      return {
        dependency: 'operator-auth',
        status: 'unavailable',
        configured: true,
        host,
        dns: { ipv4, ipv6 },
        httpStatus: response.status,
        failure: 'http_5xx',
        networkCode: null,
        elapsedMs: Date.now() - startedAt,
      };
    }

    return {
      dependency: 'operator-auth',
      status: 'ok',
      configured: true,
      host,
      dns: { ipv4, ipv6 },
      httpStatus: response.status,
      failure: null,
      networkCode: null,
      elapsedMs: Date.now() - startedAt,
    };
  }

  private async request(
    path: string,
    input: { method: 'POST'; body?: string; authorization?: string },
  ): Promise<unknown> {
    const key = supabasePublishableKey();
    let response: Response;
    try {
      response = await fetch(`${supabaseAuthBaseUrl()}${path}`, {
        method: input.method,
        headers: {
          apikey: key,
          'content-type': 'application/json',
          ...(input.authorization ? { authorization: input.authorization } : {}),
        },
        ...(input.body ? { body: input.body } : {}),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ServiceUnavailableException('Operator identity provider is unavailable');
    }

    let payload: unknown = null;
    const text = await response.text();
    if (text) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        payload = null;
      }
    }

    if (response.ok) return payload;
    if (response.status === 429) {
      throw new HttpException(
        'Too many authentication attempts; retry later',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (response.status >= 500) {
      throw new ServiceUnavailableException('Operator identity provider is unavailable');
    }
    throw new UnauthorizedException('Identity verification failed');
  }
}
