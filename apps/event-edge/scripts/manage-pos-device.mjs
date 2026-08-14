import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;
const connectionString =
  process.env.DATABASE_URL ??
  'postgresql://event_commerce:localdev_only@localhost:5432/event_commerce_edge';

const action = process.argv[2];
if (!['provision', 'rotate', 'reassign', 'revoke'].includes(action)) {
  throw new Error('usage: pos-device <provision|rotate|reassign|revoke>');
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optional(name) {
  return process.env[name]?.trim() || null;
}

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function newCredential() {
  return randomBytes(32).toString('base64url');
}

const deviceId = required('DEVICE_ID');
const actor = required('DEVICE_CREDENTIAL_ACTOR');
const client = new Client({ connectionString });
await client.connect();
const output = [];

try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pos-device:${deviceId}`]);

  if (action === 'provision') {
    const eventId = required('DEVICE_EVENT_ID');
    const salesLocationId = optional('DEVICE_SALES_LOCATION_ID');
    const registerId = optional('DEVICE_REGISTER_ID');
    const existing = await client.query('SELECT 1 FROM edge_pos_devices WHERE device_id=$1', [deviceId]);
    if (existing.rowCount !== 0) {
      throw new Error('POS device already exists; rotate, reassign or revoke it instead');
    }
    const credential = newCredential();
    await client.query(
      `INSERT INTO edge_pos_devices(
         device_id,credential_sha256,credential_version,status,event_id,sales_location_id,register_id
       ) VALUES ($1,$2,1,'ACTIVE',$3,$4,$5)`,
      [deviceId, digest(credential), eventId, salesLocationId, registerId],
    );
    await client.query(
      `INSERT INTO edge_pos_device_audit(
         device_id,action,credential_version,event_id,sales_location_id,register_id,actor
       ) VALUES ($1,'PROVISIONED',1,$2,$3,$4,$5)`,
      [deviceId, eventId, salesLocationId, registerId, actor],
    );
    output.push(`DEVICE_ID=${deviceId}`);
    output.push(`DEVICE_EDGE_TOKEN=${credential}`);
    output.push('Provision this one-time token into Android secure credential storage.');
  } else {
    const existing = await client.query(
      `SELECT credential_version,status,event_id,sales_location_id,register_id
       FROM edge_pos_devices WHERE device_id=$1 FOR UPDATE`,
      [deviceId],
    );
    const row = existing.rows[0];
    if (!row) throw new Error('POS device does not exist');

    if (action === 'rotate') {
      if (row.status !== 'ACTIVE') {
        throw new Error('Revoked POS device cannot be rotated; provision a new device identity');
      }
      const credential = newCredential();
      const version = Number(row.credential_version) + 1;
      await client.query(
        `UPDATE edge_pos_devices
         SET credential_sha256=$2,credential_version=$3,updated_at=now(),last_authenticated_at=NULL
         WHERE device_id=$1`,
        [deviceId, digest(credential), version],
      );
      await client.query(
        `INSERT INTO edge_pos_device_audit(
           device_id,action,credential_version,event_id,sales_location_id,register_id,actor
         ) VALUES ($1,'ROTATED',$2,$3,$4,$5,$6)`,
        [deviceId, version, row.event_id, row.sales_location_id, row.register_id, actor],
      );
      output.push(`DEVICE_ID=${deviceId}`);
      output.push(`DEVICE_EDGE_TOKEN=${credential}`);
      output.push('The previous POS device credential is invalid immediately.');
    } else if (action === 'reassign') {
      if (row.status !== 'ACTIVE') throw new Error('Revoked POS device cannot be reassigned');
      const eventId = required('DEVICE_EVENT_ID');
      const salesLocationId = optional('DEVICE_SALES_LOCATION_ID');
      const registerId = optional('DEVICE_REGISTER_ID');
      await client.query(
        `UPDATE edge_pos_devices
         SET event_id=$2,sales_location_id=$3,register_id=$4,updated_at=now()
         WHERE device_id=$1`,
        [deviceId, eventId, salesLocationId, registerId],
      );
      await client.query(
        `INSERT INTO edge_pos_device_audit(
           device_id,action,credential_version,event_id,sales_location_id,register_id,actor
         ) VALUES ($1,'REASSIGNED',$2,$3,$4,$5,$6)`,
        [deviceId, row.credential_version, eventId, salesLocationId, registerId, actor],
      );
      output.push(`POS device ${deviceId} reassigned to event ${eventId}.`);
    } else if (row.status === 'REVOKED') {
      output.push(`POS device ${deviceId} is already revoked.`);
    } else {
      await client.query(
        `UPDATE edge_pos_devices
         SET status='REVOKED',revoked_at=now(),updated_at=now()
         WHERE device_id=$1`,
        [deviceId],
      );
      await client.query(
        `INSERT INTO edge_pos_device_audit(
           device_id,action,credential_version,event_id,sales_location_id,register_id,actor
         ) VALUES ($1,'REVOKED',$2,$3,$4,$5,$6)`,
        [deviceId, row.credential_version, row.event_id, row.sales_location_id, row.register_id, actor],
      );
      output.push(`POS device ${deviceId} revoked.`);
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
