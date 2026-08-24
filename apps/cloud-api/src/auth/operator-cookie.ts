import type { HeadersRecord } from './operator-auth.service';

export const OPERATOR_SESSION_COOKIE = 'ec_operator_session';
export const OPERATOR_LOGIN_COOKIE = 'ec_operator_login';

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function cookieValue(headers: HeadersRecord, name: string): string | undefined {
  const raw = first(headers.cookie);
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    const value = part.slice(separator + 1).trim();
    return value || undefined;
  }
  return undefined;
}

export function operatorSessionCookie(
  token: string,
  rememberDevice: boolean,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return serializeCookie(OPERATOR_SESSION_COOKIE, token, {
    secure: environment.NODE_ENV === 'production',
    ...(rememberDevice ? { maxAgeSeconds: 30 * 24 * 60 * 60 } : {}),
  });
}

export function operatorLoginCookie(
  token: string,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return serializeCookie(OPERATOR_LOGIN_COOKIE, token, {
    maxAgeSeconds: 10 * 60,
    secure: environment.NODE_ENV === 'production',
  });
}

export function clearOperatorSessionCookie(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return serializeCookie(OPERATOR_SESSION_COOKIE, '', {
    maxAgeSeconds: 0,
    secure: environment.NODE_ENV === 'production',
  });
}

export function clearOperatorLoginCookie(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return serializeCookie(OPERATOR_LOGIN_COOKIE, '', {
    maxAgeSeconds: 0,
    secure: environment.NODE_ENV === 'production',
  });
}

function serializeCookie(
  name: string,
  value: string,
  options: { maxAgeSeconds?: number; secure: boolean },
): string {
  const parts = [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    ...(options.secure ? ['Secure'] : []),
  ];
  if (options.maxAgeSeconds !== undefined) {
    parts.push(`Max-Age=${options.maxAgeSeconds}`);
  }
  return parts.join('; ');
}
