import { createHash, generateKeyPairSync } from 'node:crypto';
import { OperatorAuthService, type OperatorRole } from '../src/auth/operator-auth.service';
import { DatabaseService } from '../src/database/database.service';

const TEST_OPERATOR_KEY_PAIR = generateKeyPairSync('ed25519');
export const TEST_OPERATOR_SIGNING_PRIVATE_KEY = TEST_OPERATOR_KEY_PAIR.privateKey
  .export({ format: 'der', type: 'pkcs8' })
  .toString('base64url');
export const TEST_OPERATOR_VERIFYING_PUBLIC_KEY = TEST_OPERATOR_KEY_PAIR.publicKey
  .export({ format: 'der', type: 'spki' })
  .toString('base64url');

const CREDENTIAL_PREFIX = 'operator-test-credential-0123456789-abcdefghijklmnopqrstuvwxyz';

export function enableOperatorTestSigningKey(): void {
  process.env.OPERATOR_TOKEN_SIGNING_PRIVATE_KEY = TEST_OPERATOR_SIGNING_PRIVATE_KEY;
  process.env.OPERATOR_TOKEN_VERIFYING_PUBLIC_KEY = TEST_OPERATOR_VERIFYING_PUBLIC_KEY;
  process.env.OPERATOR_ACCESS_TOKEN_TTL_SECONDS = '900';
}

export function operatorCredential(actorId: string): string {
  return `${CREDENTIAL_PREFIX}:${actorId}`;
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export async function provisionOperator(
  database: DatabaseService,
  options: {
    actorId: string;
    organisationId: string | null;
    role: OperatorRole;
    displayName?: string;
    credential?: string;
    permissions?: Array<{ eventId: string; permission: string }>;
  },
): Promise<string> {
  const credential = options.credential ?? operatorCredential(options.actorId);
  await database.query(
    `INSERT INTO operator_accounts(
       actor_id,organisation_id,display_name,role,credential_sha256,
       credential_version,session_version,status,revoked_at
     ) VALUES ($1,$2,$3,$4,$5,1,1,'ACTIVE',NULL)
     ON CONFLICT (actor_id) DO UPDATE SET
       organisation_id=EXCLUDED.organisation_id,
       display_name=EXCLUDED.display_name,
       role=EXCLUDED.role,
       credential_sha256=EXCLUDED.credential_sha256,
       credential_version=operator_accounts.credential_version+1,
       session_version=operator_accounts.session_version+1,
       status='ACTIVE',revoked_at=NULL,last_authenticated_at=NULL,updated_at=now()`,
    [
      options.actorId,
      options.organisationId,
      options.displayName ?? `Test operator ${options.actorId.slice(0, 8)}`,
      options.role,
      digest(credential),
    ],
  );
  await database.query('DELETE FROM payment_actor_permissions WHERE actor_id=$1', [options.actorId]);
  for (const grant of options.permissions ?? []) {
    await database.query(
      `INSERT INTO payment_actor_permissions(event_id,actor_id,permission)
       VALUES ($1,$2,$3)
       ON CONFLICT (event_id,actor_id,permission) DO NOTHING`,
      [grant.eventId, options.actorId, grant.permission],
    );
  }
  return credential;
}

export async function operatorHeaders(
  auth: OperatorAuthService,
  actorId: string,
  credential = operatorCredential(actorId),
): Promise<Record<string, string>> {
  const session = await auth.createSession(actorId, credential);
  return { authorization: `Bearer ${session.accessToken}` };
}

export async function operatorToken(
  auth: OperatorAuthService,
  actorId: string,
  credential = operatorCredential(actorId),
): Promise<string> {
  return (await auth.createSession(actorId, credential)).accessToken;
}
