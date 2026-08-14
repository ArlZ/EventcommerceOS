import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;
const connectionString =
  process.env.DATABASE_URL ??
  'postgresql://event_commerce:localdev_only@localhost:5432/event_commerce_cloud';

const action = process.argv[2];
if (!['provision', 'rotate', 'revoke'].includes(action)) {
  throw new Error('usage: edge-credential <provision|rotate|revoke>');
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const edgeId = required('EDGE_ID');
const actor = required('EDGE_CREDENTIAL_ACTOR');
const suppliedCredential = process.env.EDGE_CLOUD_SYNC_TOKEN?.trim();

function newCredential() {
  if (suppliedCredential) {
    if (suppliedCredential.length < 32) {
      throw new Error('EDGE_CLOUD_SYNC_TOKEN must be at least 32 characters when supplied');
    }
    return suppliedCredential;
  }
  return randomBytes(32).toString('base64url');
}

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

const client = new Client({ connectionString });
await client.connect();
const output = [];

try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`edge-credential:${edgeId}`]);

  if (action === 'provision') {
    const organisationId = required('EDGE_ORGANISATION_ID');
    const organisation = await client.query('SELECT 1 FROM organisations WHERE id=$1', [organisationId]);
    if (organisation.rowCount !== 1) throw new Error('EDGE_ORGANISATION_ID does not exist');

    const existing = await client.query('SELECT 1 FROM edge_sync_clients WHERE edge_id=$1', [edgeId]);
    if (existing.rowCount !== 0) {
      throw new Error('Event Edge already exists; rotate or revoke it instead of reprovisioning');
    }

    const credential = newCredential();
    await client.query(
      `INSERT INTO edge_sync_clients(
         edge_id,organisation_id,credential_sha256,credential_version,status
       ) VALUES ($1,$2,$3,1,'ACTIVE')`,
      [edgeId, organisationId, digest(credential)],
    );
    await client.query(
      `INSERT INTO edge_sync_client_audit(
         edge_id,organisation_id,action,credential_version,actor
       ) VALUES ($1,$2,'PROVISIONED',1,$3)`,
      [edgeId, organisationId, actor],
    );
    output.push(`EDGE_ID=${edgeId}`);
    output.push(`EDGE_CLOUD_SYNC_TOKEN=${credential}`);
    output.push('Store the credential in the Edge runtime secret store now; Cloud retains only its digest.');
  } else {
    const existing = await client.query(
      `SELECT organisation_id::text,credential_version,status
       FROM edge_sync_clients WHERE edge_id=$1 FOR UPDATE`,
      [edgeId],
    );
    const row = existing.rows[0];
    if (!row) throw new Error('Event Edge does not exist');

    if (action === 'rotate') {
      if (row.status !== 'ACTIVE') {
        throw new Error('Revoked Event Edge cannot be rotated; provision a new identity');
      }
      const credential = newCredential();
      const version = Number(row.credential_version) + 1;
      await client.query(
        `UPDATE edge_sync_clients
         SET credential_sha256=$2,credential_version=$3,updated_at=now(),last_authenticated_at=NULL
         WHERE edge_id=$1`,
        [edgeId, digest(credential), version],
      );
      await client.query(
        `INSERT INTO edge_sync_client_audit(
           edge_id,organisation_id,action,credential_version,actor
         ) VALUES ($1,$2,'ROTATED',$3,$4)`,
        [edgeId, row.organisation_id, version, actor],
      );
      output.push(`EDGE_ID=${edgeId}`);
      output.push(`EDGE_CLOUD_SYNC_TOKEN=${credential}`);
      output.push('The previous credential is invalid immediately. Store the new credential securely.');
    } else if (row.status === 'REVOKED') {
      output.push(`Event Edge ${edgeId} is already revoked.`);
    } else {
      await client.query(
        `UPDATE edge_sync_clients SET status='REVOKED',revoked_at=now(),updated_at=now()
         WHERE edge_id=$1`,
        [edgeId],
      );
      await client.query(
        `INSERT INTO edge_sync_client_audit(
           edge_id,organisation_id,action,credential_version,actor
         ) VALUES ($1,$2,'REVOKED',$3,$4)`,
        [edgeId, row.organisation_id, row.credential_version, actor],
      );
      output.push(`Event Edge ${edgeId} revoked.`);
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
