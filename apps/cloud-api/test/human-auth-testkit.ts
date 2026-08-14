import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DatabaseService } from '../src/database/database.service';

export interface HumanSessionFixtureOptions {
  organisationId?: string;
  role?: 'ADMIN' | 'PLATFORM_ADMIN';
  userId?: string;
  email?: string;
  expiresInSeconds?: number;
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export async function provisionHumanSession(
  database: DatabaseService,
  options: HumanSessionFixtureOptions = {},
): Promise<{
  userId: string;
  token: string;
  headers: { authorization: string };
}> {
  const role = options.role ?? 'ADMIN';
  const userId = options.userId ?? randomUUID();
  const email = (options.email ?? `test-${userId}@example.invalid`).toLowerCase();
  const organisationId = options.organisationId;
  if (role === 'ADMIN' && !organisationId) {
    throw new Error('ADMIN test session requires organisationId');
  }

  await database.query(
    `INSERT INTO human_users(
       id,email,password_salt,password_hash,status,platform_role,auth_version
     ) VALUES ($1,$2,$3,$4,'ACTIVE',$5,1)
     ON CONFLICT (id) DO UPDATE SET
       status='ACTIVE',disabled_at=NULL,platform_role=EXCLUDED.platform_role,auth_version=1,updated_at=now()`,
    [
      userId,
      email,
      randomBytes(16),
      randomBytes(64),
      role === 'PLATFORM_ADMIN' ? 'PLATFORM_ADMIN' : null,
    ],
  );

  if (organisationId) {
    await database.query(
      `INSERT INTO human_organisation_memberships(
         user_id,organisation_id,role,status,revoked_at
       ) VALUES ($1,$2,'ADMIN','ACTIVE',NULL)
       ON CONFLICT (user_id,organisation_id) DO UPDATE SET
         role='ADMIN',status='ACTIVE',revoked_at=NULL,updated_at=now()`,
      [userId, organisationId],
    );
  }

  const token = randomBytes(32).toString('base64url');
  const sessionId = randomUUID();
  await database.query(
    `INSERT INTO human_sessions(
       id,user_id,organisation_id,role,token_sha256,user_auth_version,expires_at
     ) VALUES ($1,$2,$3,$4,$5,1,now()+($6 * interval '1 second'))`,
    [
      sessionId,
      userId,
      organisationId ?? null,
      role,
      digest(token),
      options.expiresInSeconds ?? 3600,
    ],
  );
  return { userId, token, headers: { authorization: `Bearer ${token}` } };
}
