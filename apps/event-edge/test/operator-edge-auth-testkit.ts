import { generateKeyPairSync, randomUUID, sign as signBytes } from 'node:crypto';

const KEY_PAIR = generateKeyPairSync('ed25519');
const PRIVATE_KEY = KEY_PAIR.privateKey;
export const TEST_EDGE_OPERATOR_PUBLIC_KEY = KEY_PAIR.publicKey
  .export({ format: 'der', type: 'spki' })
  .toString('base64url');

export const TEST_EDGE_ORGANISATION_ID = '51111111-1111-4111-8111-111111111111';

export function enableEdgeOperatorTestAuth(): void {
  process.env.OPERATOR_TOKEN_VERIFYING_PUBLIC_KEY = TEST_EDGE_OPERATOR_PUBLIC_KEY;
  process.env.EDGE_ORGANISATION_ID = TEST_EDGE_ORGANISATION_ID;
}

export function edgeOperatorToken(options: {
  actorId: string;
  role?: 'OPERATOR' | 'SUPERVISOR' | 'ADMIN' | 'PLATFORM_ADMIN';
  organisationId?: string | null;
  issuedAt?: number;
  expiresAt?: number;
}): string {
  const now = options.issuedAt ?? Math.floor(Date.now() / 1000);
  const role = options.role ?? 'OPERATOR';
  const organisationId =
    options.organisationId === undefined
      ? role === 'PLATFORM_ADMIN'
        ? null
        : TEST_EDGE_ORGANISATION_ID
      : options.organisationId;
  const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' }), 'utf8').toString(
    'base64url',
  );
  const claims = Buffer.from(
    JSON.stringify({
      iss: 'event-commerce-cloud',
      aud: 'operator',
      sub: options.actorId,
      org: organisationId,
      role,
      ver: 1,
      sv: 1,
      iat: now,
      exp: options.expiresAt ?? now + 900,
      jti: randomUUID(),
    }),
    'utf8',
  ).toString('base64url');
  const body = `${header}.${claims}`;
  const signature = signBytes(null, Buffer.from(body, 'utf8'), PRIVATE_KEY).toString('base64url');
  return `${body}.${signature}`;
}

export function edgeOperatorHeaders(
  actorId: string,
  options: Omit<Parameters<typeof edgeOperatorToken>[0], 'actorId'> = {},
): Record<string, string> {
  return { authorization: `Bearer ${edgeOperatorToken({ actorId, ...options })}` };
}
