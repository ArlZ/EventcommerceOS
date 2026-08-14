import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{32,}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

export interface IssuedOpaqueCredential {
  credentialId: string;
  token: string;
  secretHash: string;
}

export interface ParsedOpaqueCredential {
  credentialId: string;
  secret: string;
}

export function hashCredentialSecret(secret: string): string {
  if (!SECRET_PATTERN.test(secret)) throw new Error('Credential secret format is invalid');
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function issueOpaqueCredential(
  credentialId: string = randomUUID(),
): IssuedOpaqueCredential {
  if (!UUID_PATTERN.test(credentialId)) throw new Error('Credential ID must be a UUID');
  const secret = randomBytes(32).toString('base64url');
  return {
    credentialId,
    token: `${credentialId}.${secret}`,
    secretHash: hashCredentialSecret(secret),
  };
}

export function parseOpaqueCredential(token: string): ParsedOpaqueCredential {
  const separator = token.indexOf('.');
  if (separator <= 0 || separator !== token.lastIndexOf('.')) {
    throw new Error('Credential token format is invalid');
  }
  const credentialId = token.slice(0, separator);
  const secret = token.slice(separator + 1);
  if (!UUID_PATTERN.test(credentialId) || !SECRET_PATTERN.test(secret)) {
    throw new Error('Credential token format is invalid');
  }
  return { credentialId, secret };
}

export function verifyCredentialSecret(secret: string, expectedHash: string): boolean {
  if (!HASH_PATTERN.test(expectedHash)) return false;
  let actualHash: string;
  try {
    actualHash = hashCredentialSecret(secret);
  } catch {
    return false;
  }
  const actual = Buffer.from(actualHash, 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function parseAuthorizationCredential(
  value: string | undefined,
  expectedScheme: string,
): ParsedOpaqueCredential {
  if (!value) throw new Error('Authorization credential is required');
  const separator = value.indexOf(' ');
  if (separator <= 0) throw new Error('Authorization credential format is invalid');
  const scheme = value.slice(0, separator);
  const token = value.slice(separator + 1).trim();
  if (scheme.toLowerCase() !== expectedScheme.toLowerCase() || !token) {
    throw new Error('Authorization credential scheme is invalid');
  }
  return parseOpaqueCredential(token);
}
