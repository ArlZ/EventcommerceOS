import { createHash, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;
const connectionString =
  process.env.DATABASE_URL ??
  'postgresql://event_commerce:localdev_only@localhost:5432/event_commerce_cloud';

const action = process.argv[2];
const actions = ['provision', 'rotate', 'revoke', 'grant-permission', 'revoke-permission'];
if (!actions.includes(action)) {
  throw new Error(`usage: operator-credential <${actions.join('|')}>`);
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optional(name) {
  return process.env[name]?.trim() || null;
}

function uuid(value, name) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${name} must be a UUID`);
  }
  return value;
}

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function newCredential() {
  return randomBytes(32).toString('base64url');
}

function role(value) {
  if (!['OPERATOR', 'SUPERVISOR', 'ADMIN', 'PLATFORM_ADMIN'].includes(value)) {
    throw new Error('OPERATOR_ROLE must be OPERATOR, SUPERVISOR, ADMIN, or PLATFORM_ADMIN');
  }
  return value;
}

function permission(value) {
  if (!['PAYMENT_MANUAL_CONFIRM', 'PAYMENT_REFUND', 'PAYMENT_VIEW'].includes(value)) {
    throw new Error(
      'OPERATOR_PERMISSION must be PAYMENT_MANUAL_CONFIRM, PAYMENT_REFUND, or PAYMENT_VIEW',
    );
  }
  return value;
}

const performedBy = required('OPERATOR_CREDENTIAL_ACTOR');
const operatorId =
  action === 'provision'
    ? uuid(optional('OPERATOR_ID') ?? randomUUID(), 'OPERATOR_ID')
    : uuid(required('OPERATOR_ID'), 'OPERATOR_ID');

const client = new Client({ connectionString });
await client.connect();
const output = [];

try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`operator:${operatorId}`]);

  if (action === 'provision') {
    const displayName = required('OPERATOR_DISPLAY_NAME');
    const operatorRole = role(required('OPERATOR_ROLE'));
    const organisationId = optional('OPERATOR_ORGANISATION_ID');
    if (operatorRole === 'PLATFORM_ADMIN' && organisationId !== null) {
      throw new Error('PLATFORM_ADMIN must not have OPERATOR_ORGANISATION_ID');
    }
    if (operatorRole !== 'PLATFORM_ADMIN' && organisationId === null) {
      throw new Error(`${operatorRole} requires OPERATOR_ORGANISATION_ID`);
    }
    if (organisationId !== null) {
      uuid(organisationId, 'OPERATOR_ORGANISATION_ID');
      const organisation = await client.query('SELECT 1 FROM organisations WHERE id=$1', [
        organisationId,
      ]);
      if (organisation.rowCount !== 1) throw new Error('OPERATOR_ORGANISATION_ID does not exist');
    }
    const existing = await client.query('SELECT 1 FROM operator_accounts WHERE actor_id=$1', [
      operatorId,
    ]);
    if (existing.rowCount !== 0) {
      throw new Error('Operator already exists; rotate or revoke it instead of reprovisioning');
    }

    const credential = newCredential();
    await client.query(
      `INSERT INTO operator_accounts(
         actor_id,organisation_id,display_name,role,credential_sha256,
         credential_version,session_version,status
       ) VALUES ($1,$2,$3,$4,$5,1,1,'ACTIVE')`,
      [operatorId, organisationId, displayName, operatorRole, digest(credential)],
    );
    await client.query(
      `INSERT INTO operator_account_audit(
         actor_id,organisation_id,action,role,credential_version,session_version,performed_by
       ) VALUES ($1,$2,'PROVISIONED',$3,1,1,$4)`,
      [operatorId, organisationId, operatorRole, performedBy],
    );
    output.push(`OPERATOR_ID=${operatorId}`);
    output.push(`OPERATOR_CREDENTIAL=${credential}`);
    output.push('Store this one-time credential in the operator password/secret manager.');
  } else {
    const existing = await client.query(
      `SELECT actor_id::text,organisation_id::text,role,credential_version,session_version,status
       FROM operator_accounts WHERE actor_id=$1 FOR UPDATE`,
      [operatorId],
    );
    const row = existing.rows[0];
    if (!row) throw new Error('Operator does not exist');

    if (action === 'rotate') {
      if (row.status !== 'ACTIVE') throw new Error('Revoked operator cannot be rotated');
      const credential = newCredential();
      const credentialVersion = Number(row.credential_version) + 1;
      const sessionVersion = Number(row.session_version) + 1;
      await client.query(
        `UPDATE operator_accounts
         SET credential_sha256=$2,credential_version=$3,session_version=$4,
             last_authenticated_at=NULL,updated_at=now()
         WHERE actor_id=$1`,
        [operatorId, digest(credential), credentialVersion, sessionVersion],
      );
      await client.query(
        `INSERT INTO operator_account_audit(
           actor_id,organisation_id,action,role,credential_version,session_version,performed_by
         ) VALUES ($1,$2,'ROTATED',$3,$4,$5,$6)`,
        [
          operatorId,
          row.organisation_id,
          row.role,
          credentialVersion,
          sessionVersion,
          performedBy,
        ],
      );
      output.push(`OPERATOR_ID=${operatorId}`);
      output.push(`OPERATOR_CREDENTIAL=${credential}`);
      output.push('All previous credentials and access tokens are invalid immediately.');
    } else if (action === 'revoke') {
      if (row.status === 'REVOKED') {
        output.push(`Operator ${operatorId} is already revoked.`);
      } else {
        const sessionVersion = Number(row.session_version) + 1;
        await client.query(
          `UPDATE operator_accounts
           SET status='REVOKED',session_version=$2,revoked_at=now(),updated_at=now()
           WHERE actor_id=$1`,
          [operatorId, sessionVersion],
        );
        await client.query(
          `INSERT INTO operator_account_audit(
             actor_id,organisation_id,action,role,credential_version,session_version,performed_by
           ) VALUES ($1,$2,'REVOKED',$3,$4,$5,$6)`,
          [
            operatorId,
            row.organisation_id,
            row.role,
            row.credential_version,
            sessionVersion,
            performedBy,
          ],
        );
        output.push(`Operator ${operatorId} revoked.`);
      }
    } else {
      if (row.status !== 'ACTIVE') throw new Error('Cannot change permissions for a revoked operator');
      const eventId = required('OPERATOR_EVENT_ID');
      const operatorPermission = permission(required('OPERATOR_PERMISSION'));
      const event = await client.query(
        'SELECT organisation_id::text FROM events WHERE id=$1',
        [eventId],
      );
      const eventOrganisationId = event.rows[0]?.organisation_id;
      if (!eventOrganisationId) throw new Error('OPERATOR_EVENT_ID does not exist');
      if (row.role !== 'PLATFORM_ADMIN' && row.organisation_id !== eventOrganisationId) {
        throw new Error('Operator cannot receive a permission outside their organisation');
      }

      if (action === 'grant-permission') {
        await client.query(
          `INSERT INTO payment_actor_permissions(event_id,actor_id,permission)
           VALUES ($1,$2,$3)
           ON CONFLICT (event_id,actor_id,permission) DO NOTHING`,
          [eventId, operatorId, operatorPermission],
        );
        await client.query(
          `INSERT INTO operator_account_audit(
             actor_id,organisation_id,action,role,credential_version,session_version,
             event_id,permission,performed_by
           ) VALUES ($1,$2,'PERMISSION_GRANTED',$3,$4,$5,$6,$7,$8)`,
          [
            operatorId,
            row.organisation_id,
            row.role,
            row.credential_version,
            row.session_version,
            eventId,
            operatorPermission,
            performedBy,
          ],
        );
        output.push(`${operatorPermission} granted to ${operatorId} for ${eventId}.`);
      } else {
        await client.query(
          'DELETE FROM payment_actor_permissions WHERE event_id=$1 AND actor_id=$2 AND permission=$3',
          [eventId, operatorId, operatorPermission],
        );
        await client.query(
          `INSERT INTO operator_account_audit(
             actor_id,organisation_id,action,role,credential_version,session_version,
             event_id,permission,performed_by
           ) VALUES ($1,$2,'PERMISSION_REVOKED',$3,$4,$5,$6,$7,$8)`,
          [
            operatorId,
            row.organisation_id,
            row.role,
            row.credential_version,
            row.session_version,
            eventId,
            operatorPermission,
            performedBy,
          ],
        );
        output.push(`${operatorPermission} revoked from ${operatorId} for ${eventId}.`);
      }
    }
  }

  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  await client.end();
}

for (const line of output) console.log(line);
