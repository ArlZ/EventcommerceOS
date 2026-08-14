import { createHash } from 'node:crypto';
import { EdgeDatabaseService } from '../src/database/database.service';

export const DEFAULT_DEVICE_EVENT_ID = 'event-pos-auth-test';
const TOKEN_PREFIX = 'pos-device-test-token-0123456789-abcdefghijklmnopqrstuvwxyz';

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function tokenForDevice(deviceId: string): string {
  return `${TOKEN_PREFIX}:${deviceId}`;
}

export function posDeviceHeaders(deviceId: string, token = tokenForDevice(deviceId)) {
  return {
    'x-device-id': deviceId,
    authorization: `Bearer ${token}`,
  };
}

export async function ensureDeviceEvent(
  database: EdgeDatabaseService,
  eventId = DEFAULT_DEVICE_EVENT_ID,
): Promise<void> {
  await database.query(
    `INSERT INTO edge_inventory_event_config(event_id,event_end_at)
     VALUES ($1,'2026-08-16T00:00:00Z')
     ON CONFLICT (event_id) DO NOTHING`,
    [eventId],
  );
}

export async function provisionPosDevice(
  database: EdgeDatabaseService,
  deviceId: string,
  options: {
    eventId?: string;
    salesLocationId?: string | null;
    registerId?: string | null;
    token?: string;
  } = {},
): Promise<{ token: string; headers: ReturnType<typeof posDeviceHeaders> }> {
  const eventId = options.eventId ?? DEFAULT_DEVICE_EVENT_ID;
  const token = options.token ?? tokenForDevice(deviceId);
  await ensureDeviceEvent(database, eventId);
  await database.query(
    `INSERT INTO edge_pos_devices(
       device_id,credential_sha256,credential_version,status,event_id,sales_location_id,register_id,revoked_at
     ) VALUES ($1,$2,1,'ACTIVE',$3,$4,$5,NULL)
     ON CONFLICT (device_id) DO UPDATE SET
       credential_sha256=EXCLUDED.credential_sha256,
       credential_version=edge_pos_devices.credential_version+1,
       status='ACTIVE',event_id=EXCLUDED.event_id,
       sales_location_id=EXCLUDED.sales_location_id,register_id=EXCLUDED.register_id,
       revoked_at=NULL,last_authenticated_at=NULL,updated_at=now()`,
    [
      deviceId,
      digest(token),
      eventId,
      options.salesLocationId ?? null,
      options.registerId ?? null,
    ],
  );
  return { token, headers: posDeviceHeaders(deviceId, token) };
}

export async function revokePosDevice(
  database: EdgeDatabaseService,
  deviceId: string,
): Promise<void> {
  await database.query(
    `UPDATE edge_pos_devices
     SET status='REVOKED',revoked_at=now(),updated_at=now()
     WHERE device_id=$1`,
    [deviceId],
  );
}
