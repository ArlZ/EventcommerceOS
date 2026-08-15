import { createHash, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;
const connectionString =
  process.env.DATABASE_URL ??
  'postgresql://event_commerce:localdev_only@localhost:5432/event_commerce_cloud';

const action = process.argv[2];
const actions = new Set([
  'create-identity',
  'grant-membership',
  'revoke-membership',
  'create-session',
  'revoke-session',
  'revoke-identity',
]);
if (!actions.has(action)) {
  throw new Error(
    'usage: operator-auth <create-identity|grant-membership|revoke-membership|create-session|revoke-session|revoke-identity>',
  );
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optional(name) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function bool(name) {
  const value = optional(name);
  if (value === undefined) return false;
  if (value !== 'true' && value !== 'false') throw new Error(`${name} must be true or false`);
  return value === 'true';
}

function sessionTtlMinutes() {
  const value = Number(optional('OPERATOR_SESSION_TTL_MINUTES') ?? '480');
  if (!Number.isSafeInteger(value) || value < 5 || value > 1440) {
    throw new Error('OPERATOR_SESSION_TTL_MINUTES must be an integer between 5 and 1440');
  }
  return value;
}

const performedBy = required('OPERATOR_AUTH_ACTOR');
const client = new Client({ connectionString });
await client.connect();
const output = [];

async function audit({
  actorId = null,
  organisationId = null,
  auditAction,
  targetActorId = null,
  sessionId = null,
  role = null,
  details = {},
}) {
  await client.query(
    `INSERT INTO operator_auth_audit(
       actor_id,organisation_id,action,target_actor_id,session_id,role,performed_by,details
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [
      actorId,
      organisationId,
      auditAction,
      targetActorId,
      sessionId,
      role,
      performedBy,
      JSON.stringify(details),
    ],
  );
}

try {
  await client.query('BEGIN');

  if (action === 'create-identity') {
    const actorId = optional('OPERATOR_ID') ?? randomUUID();
    const displayName = required('OPERATOR_DISPLAY_NAME');
    const email = optional('OPERATOR_EMAIL') ?? null;
    const platformAdmin = bool('OPERATOR_PLATFORM_ADMIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `operator-identity:${actorId}`,
    ]);
    await client.query(
      `INSERT INTO operator_identities(id,display_name,email,platform_role)
       VALUES ($1,$2,$3,$4)`,
      [actorId, displayName, email, platformAdmin ? 'PLATFORM_ADMIN' : null],
    );
    await audit({
      auditAction: 'IDENTITY_CREATED',
      targetActorId: actorId,
      details: { displayName, email, platformAdmin },
    });
    output.push(`OPERATOR_ID=${actorId}`);
    output.push(`Created ${platformAdmin ? 'platform administrator' : 'operator'} ${displayName}.`);
  }

  if (action === 'grant-membership') {
    const actorId = required('OPERATOR_ID');
    const organisationId = required('OPERATOR_ORGANISATION_ID');
    const role = required('OPERATOR_ROLE').toUpperCase();
    if (!['ADMIN', 'FINANCE', 'SUPERVISOR', 'VIEWER'].includes(role)) {
      throw new Error('OPERATOR_ROLE must be ADMIN, FINANCE, SUPERVISOR or VIEWER');
    }
    const identity = await client.query(
      `SELECT 1 FROM operator_identities WHERE id=$1 AND status='ACTIVE'`,
      [actorId],
    );
    if (identity.rowCount !== 1) throw new Error('OPERATOR_ID is not an active operator');
    const organisation = await client.query('SELECT 1 FROM organisations WHERE id=$1', [
      organisationId,
    ]);
    if (organisation.rowCount !== 1) throw new Error('OPERATOR_ORGANISATION_ID does not exist');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `operator-membership:${actorId}:${organisationId}`,
    ]);
    await client.query(
      `INSERT INTO operator_memberships(actor_id,organisation_id,role,status,revoked_at)
       VALUES ($1,$2,$3,'ACTIVE',NULL)
       ON CONFLICT (actor_id,organisation_id) DO UPDATE SET
         role=EXCLUDED.role,status='ACTIVE',revoked_at=NULL,updated_at=now()`,
      [actorId, organisationId, role],
    );
    await audit({
      actorId,
      organisationId,
      auditAction: 'MEMBERSHIP_GRANTED',
      targetActorId: actorId,
      role,
    });
    output.push(`Granted ${role} on ${organisationId} to ${actorId}.`);
  }

  if (action === 'revoke-membership') {
    const actorId = required('OPERATOR_ID');
    const organisationId = required('OPERATOR_ORGANISATION_ID');
    const rows = await client.query(
      `UPDATE operator_memberships
       SET status='REVOKED',revoked_at=now(),updated_at=now()
       WHERE actor_id=$1 AND organisation_id=$2 AND status='ACTIVE'
       RETURNING role`,
      [actorId, organisationId],
    );
    if (rows.rowCount !== 1) throw new Error('Active operator membership not found');
    await audit({
      actorId,
      organisationId,
      auditAction: 'MEMBERSHIP_REVOKED',
      targetActorId: actorId,
      role: rows.rows[0].role,
    });
    output.push(`Revoked membership for ${actorId} on ${organisationId}.`);
  }

  if (action === 'create-session') {
    const actorId = required('OPERATOR_ID');
    const ttlMinutes = sessionTtlMinutes();
    const identity = await client.query(
      `SELECT 1 FROM operator_identities WHERE id=$1 AND status='ACTIVE'`,
      [actorId],
    );
    if (identity.rowCount !== 1) throw new Error('OPERATOR_ID is not an active operator');
    const sessionId = randomUUID();
    const token = `ecom_op_${randomBytes(32).toString('base64url')}`;
    await client.query(
      `INSERT INTO operator_sessions(id,actor_id,token_sha256,expires_at)
       VALUES ($1,$2,$3,now()+($4::text || ' minutes')::interval)`,
      [sessionId, actorId, digest(token), ttlMinutes],
    );
    await audit({
      actorId,
      auditAction: 'SESSION_CREATED',
      targetActorId: actorId,
      sessionId,
      details: { ttlMinutes },
    });
    output.push(`OPERATOR_SESSION_ID=${sessionId}`);
    output.push(`OPERATOR_ACCESS_TOKEN=${token}`);
    output.push(
      `Session expires in ${ttlMinutes} minutes. Store the access token in a managed secret/session store now; Cloud retains only its digest.`,
    );
  }

  if (action === 'revoke-session') {
    const sessionId = required('OPERATOR_SESSION_ID');
    const rows = await client.query(
      `UPDATE operator_sessions
       SET revoked_at=now()
       WHERE id=$1 AND revoked_at IS NULL
       RETURNING actor_id::text`,
      [sessionId],
    );
    if (rows.rowCount !== 1) throw new Error('Active operator session not found');
    const actorId = rows.rows[0].actor_id;
    await audit({
      actorId,
      auditAction: 'SESSION_REVOKED',
      targetActorId: actorId,
      sessionId,
    });
    output.push(`Revoked operator session ${sessionId}.`);
  }

  if (action === 'revoke-identity') {
    const actorId = required('OPERATOR_ID');
    const rows = await client.query(
      `UPDATE operator_identities
       SET status='REVOKED',revoked_at=now(),updated_at=now()
       WHERE id=$1 AND status='ACTIVE'
       RETURNING id`,
      [actorId],
    );
    if (rows.rowCount !== 1) throw new Error('Active operator identity not found');
    await client.query(
      `UPDATE operator_sessions SET revoked_at=coalesce(revoked_at,now())
       WHERE actor_id=$1 AND revoked_at IS NULL`,
      [actorId],
    );
    await client.query(
      `UPDATE operator_memberships
       SET status='REVOKED',revoked_at=coalesce(revoked_at,now()),updated_at=now()
       WHERE actor_id=$1 AND status='ACTIVE'`,
      [actorId],
    );
    await audit({
      actorId,
      auditAction: 'IDENTITY_REVOKED',
      targetActorId: actorId,
    });
    output.push(`Revoked operator identity ${actorId} and its active sessions/memberships.`);
  }

  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  await client.end();
}

for (const line of output) console.log(line);
