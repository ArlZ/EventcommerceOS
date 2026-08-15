import { createHash, randomUUID } from 'node:crypto';
import type { OperatorOrganisationRole } from '../src/auth/operator-auth.service';
import type { DatabaseService } from '../src/database/database.service';

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function tokenFor(actorId: string): string {
  return `ecom_op_test_${createHash('sha256').update(actorId).digest('hex')}`;
}

export interface OperatorFixtureOptions {
  actorId: string;
  displayName?: string;
  platformAdmin?: boolean;
  memberships?: Array<{ organisationId: string; role: OperatorOrganisationRole }>;
  expiresInMinutes?: number;
}

export async function provisionOperator(
  database: DatabaseService,
  options: OperatorFixtureOptions,
): Promise<{ token: string; headers: (organisationId?: string) => Record<string, string> }> {
  const token = tokenFor(options.actorId);
  await database.query(
    `INSERT INTO operator_identities(id,display_name,status,platform_role,revoked_at)
     VALUES ($1,$2,'ACTIVE',$3,NULL)
     ON CONFLICT (id) DO UPDATE SET
       display_name=EXCLUDED.display_name,status='ACTIVE',platform_role=EXCLUDED.platform_role,
       revoked_at=NULL,updated_at=now()`,
    [
      options.actorId,
      options.displayName ?? `Test operator ${options.actorId.slice(0, 8)}`,
      options.platformAdmin ? 'PLATFORM_ADMIN' : null,
    ],
  );

  for (const membership of options.memberships ?? []) {
    await grantOperatorMembership(database, options.actorId, membership.organisationId, membership.role);
  }

  await database.query(
    `INSERT INTO operator_sessions(id,actor_id,token_sha256,expires_at,revoked_at)
     VALUES ($1,$2,$3,now()+($4::text || ' minutes')::interval,NULL)
     ON CONFLICT (token_sha256) DO UPDATE SET
       actor_id=EXCLUDED.actor_id,expires_at=EXCLUDED.expires_at,revoked_at=NULL,
       last_authenticated_at=NULL`,
    [randomUUID(), options.actorId, digest(token), options.expiresInMinutes ?? 60],
  );

  return {
    token,
    headers: (organisationId?: string) => ({
      authorization: `Bearer ${token}`,
      ...(organisationId ? { 'x-organisation-id': organisationId } : {}),
    }),
  };
}

export async function grantOperatorMembership(
  database: DatabaseService,
  actorId: string,
  organisationId: string,
  role: OperatorOrganisationRole,
): Promise<void> {
  await database.query(
    `INSERT INTO operator_memberships(actor_id,organisation_id,role,status,revoked_at)
     VALUES ($1,$2,$3,'ACTIVE',NULL)
     ON CONFLICT (actor_id,organisation_id) DO UPDATE SET
       role=EXCLUDED.role,status='ACTIVE',revoked_at=NULL,updated_at=now()`,
    [actorId, organisationId, role],
  );
}

export async function revokeOperatorSession(
  database: DatabaseService,
  token: string,
): Promise<void> {
  await database.query(
    'UPDATE operator_sessions SET revoked_at=now() WHERE token_sha256=$1',
    [digest(token)],
  );
}

export async function revokeOperatorIdentity(
  database: DatabaseService,
  actorId: string,
): Promise<void> {
  await database.query(
    `UPDATE operator_identities SET status='REVOKED',revoked_at=now(),updated_at=now()
     WHERE id=$1`,
    [actorId],
  );
}
