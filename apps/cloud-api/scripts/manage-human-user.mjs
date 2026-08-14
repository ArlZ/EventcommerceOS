import { randomBytes, randomUUID, scrypt } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;
const connectionString =
  process.env.DATABASE_URL ??
  'postgresql://event_commerce:localdev_only@localhost:5432/event_commerce_cloud';

const action = process.argv[2];
if (!['provision', 'password', 'disable', 'enable', 'grant', 'revoke'].includes(action)) {
  throw new Error('usage: human-user <provision|password|disable|enable|grant|revoke>');
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function email() {
  const value = required('HUMAN_EMAIL').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error('HUMAN_EMAIL is invalid');
  return value;
}

function generatedPassword() {
  const supplied = process.env.HUMAN_PASSWORD;
  if (supplied !== undefined) {
    if (supplied.length < 14 || supplied.length > 256) {
      throw new Error('HUMAN_PASSWORD must be between 14 and 256 characters');
    }
    return supplied;
  }
  return randomBytes(24).toString('base64url');
}

function derive(password, salt) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

async function passwordMaterial() {
  const password = generatedPassword();
  const salt = randomBytes(16);
  return { password, salt, hash: await derive(password, salt) };
}

const targetEmail = email();
const client = new Client({ connectionString });
await client.connect();
let revealPassword;
let message;

try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`human-user:${targetEmail}`]);

  if (action === 'provision') {
    const existing = await client.query('SELECT 1 FROM human_users WHERE email=$1', [targetEmail]);
    if (existing.rowCount !== 0) throw new Error('Human user already exists');
    const platformAdmin = process.env.HUMAN_PLATFORM_ADMIN === 'true';
    const organisationId = process.env.HUMAN_ORGANISATION_ID?.trim() || null;
    if (!platformAdmin && !organisationId) {
      throw new Error('HUMAN_ORGANISATION_ID is required unless HUMAN_PLATFORM_ADMIN=true');
    }
    if (organisationId) {
      const org = await client.query('SELECT 1 FROM organisations WHERE id=$1', [organisationId]);
      if (org.rowCount !== 1) throw new Error('HUMAN_ORGANISATION_ID does not exist');
    }
    const userId = randomUUID();
    const material = await passwordMaterial();
    await client.query(
      `INSERT INTO human_users(id,email,password_salt,password_hash,platform_role)
       VALUES ($1,$2,$3,$4,$5)`,
      [userId, targetEmail, material.salt, material.hash, platformAdmin ? 'PLATFORM_ADMIN' : null],
    );
    if (organisationId) {
      await client.query(
        `INSERT INTO human_organisation_memberships(user_id,organisation_id,role,status)
         VALUES ($1,$2,'ADMIN','ACTIVE')`,
        [userId, organisationId],
      );
      await client.query(
        `INSERT INTO human_auth_audit(user_id,organisation_id,action,actor_id,details)
         VALUES ($1,$2,'MEMBERSHIP_GRANTED',NULL,$3::jsonb)`,
        [userId, organisationId, JSON.stringify({ role: 'ADMIN', source: 'operator-cli' })],
      );
    }
    await client.query(
      `INSERT INTO human_auth_audit(user_id,organisation_id,action,actor_id,details)
       VALUES ($1,$2,'USER_PROVISIONED',NULL,$3::jsonb)`,
      [userId, organisationId, JSON.stringify({ email: targetEmail, platformAdmin, source: 'operator-cli' })],
    );
    await client.query('COMMIT');
    revealPassword = material.password;
    message = `Provisioned ${targetEmail} (${userId})`;
  } else {
    const existing = await client.query(
      `SELECT id::text,status,platform_role,auth_version FROM human_users WHERE email=$1 FOR UPDATE`,
      [targetEmail],
    );
    const user = existing.rows[0];
    if (!user) throw new Error('Human user does not exist');

    if (action === 'password') {
      const material = await passwordMaterial();
      const nextVersion = Number(user.auth_version) + 1;
      await client.query(
        `UPDATE human_users
         SET password_salt=$2,password_hash=$3,auth_version=$4,updated_at=now()
         WHERE id=$1`,
        [user.id, material.salt, material.hash, nextVersion],
      );
      await client.query('UPDATE human_sessions SET revoked_at=coalesce(revoked_at,now()) WHERE user_id=$1', [user.id]);
      await client.query(
        `INSERT INTO human_auth_audit(user_id,action,actor_id,details)
         VALUES ($1,'PASSWORD_ROTATED',NULL,$2::jsonb)`,
        [user.id, JSON.stringify({ authVersion: nextVersion, source: 'operator-cli' })],
      );
      await client.query('COMMIT');
      revealPassword = material.password;
      message = `Rotated password for ${targetEmail}; all existing sessions revoked`;
    } else if (action === 'disable' || action === 'enable') {
      const disabling = action === 'disable';
      const nextVersion = Number(user.auth_version) + 1;
      await client.query(
        `UPDATE human_users
         SET status=$2,disabled_at=$3,auth_version=$4,updated_at=now()
         WHERE id=$1`,
        [user.id, disabling ? 'DISABLED' : 'ACTIVE', disabling ? new Date() : null, nextVersion],
      );
      await client.query('UPDATE human_sessions SET revoked_at=coalesce(revoked_at,now()) WHERE user_id=$1', [user.id]);
      await client.query(
        `INSERT INTO human_auth_audit(user_id,action,actor_id,details)
         VALUES ($1,$2,NULL,$3::jsonb)`,
        [user.id, disabling ? 'USER_DISABLED' : 'USER_ENABLED', JSON.stringify({ authVersion: nextVersion, source: 'operator-cli' })],
      );
      await client.query('COMMIT');
      message = `${disabling ? 'Disabled' : 'Enabled'} ${targetEmail}; all existing sessions revoked`;
    } else {
      const organisationId = required('HUMAN_ORGANISATION_ID');
      const org = await client.query('SELECT 1 FROM organisations WHERE id=$1', [organisationId]);
      if (org.rowCount !== 1) throw new Error('HUMAN_ORGANISATION_ID does not exist');
      if (action === 'grant') {
        await client.query(
          `INSERT INTO human_organisation_memberships(user_id,organisation_id,role,status,revoked_at)
           VALUES ($1,$2,'ADMIN','ACTIVE',NULL)
           ON CONFLICT (user_id,organisation_id) DO UPDATE SET
             role='ADMIN',status='ACTIVE',revoked_at=NULL,updated_at=now()`,
          [user.id, organisationId],
        );
        await client.query(
          `INSERT INTO human_auth_audit(user_id,organisation_id,action,actor_id,details)
           VALUES ($1,$2,'MEMBERSHIP_GRANTED',NULL,$3::jsonb)`,
          [user.id, organisationId, JSON.stringify({ role: 'ADMIN', source: 'operator-cli' })],
        );
        message = `Granted ADMIN membership for ${targetEmail}`;
      } else {
        const updated = await client.query(
          `UPDATE human_organisation_memberships
           SET status='REVOKED',revoked_at=now(),updated_at=now()
           WHERE user_id=$1 AND organisation_id=$2 AND status='ACTIVE'`,
          [user.id, organisationId],
        );
        if (updated.rowCount !== 1) throw new Error('Active membership does not exist');
        await client.query(
          `UPDATE human_sessions SET revoked_at=coalesce(revoked_at,now())
           WHERE user_id=$1 AND organisation_id=$2`,
          [user.id, organisationId],
        );
        await client.query(
          `INSERT INTO human_auth_audit(user_id,organisation_id,action,actor_id,details)
           VALUES ($1,$2,'MEMBERSHIP_REVOKED',NULL,$3::jsonb)`,
          [user.id, organisationId, JSON.stringify({ source: 'operator-cli' })],
        );
        message = `Revoked membership for ${targetEmail}`;
      }
      await client.query('COMMIT');
    }
  }
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  await client.end();
}

console.log(message);
if (revealPassword) {
  console.log(`HUMAN_PASSWORD=${revealPassword}`);
  console.log('Reveal/store this password securely now. Cloud retains only its scrypt-derived hash.');
}
