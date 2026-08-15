import { createHash } from 'node:crypto';
import type { DatabaseService } from '../src/database/database.service';

export const DEFAULT_SYNC_ORGANISATION_ID = '11111111-1111-4111-8111-111111111111';
export const DEFAULT_SYNC_EVENT_ID = '22222222-2222-4222-8222-222222222222';
const DEFAULT_SYNC_TOKEN_PREFIX = 'test-edge-sync-token-0123456789-abcdefghijklmnopqrstuvwxyz';

export interface SyncEdgeFixtureOptions {
  edgeId: string;
  organisationId?: string;
  eventIds?: string[];
  token?: string;
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function defaultToken(edgeId: string): string {
  return `${DEFAULT_SYNC_TOKEN_PREFIX}:${edgeId}`;
}

export function syncEdgeHeaders(edgeId: string, token = defaultToken(edgeId)) {
  return {
    'x-edge-id': edgeId,
    authorization: `Bearer ${token}`,
  };
}

export async function provisionSyncEdge(
  database: DatabaseService,
  options: SyncEdgeFixtureOptions,
): Promise<{ organisationId: string; token: string; headers: ReturnType<typeof syncEdgeHeaders> }> {
  const organisationId = options.organisationId ?? DEFAULT_SYNC_ORGANISATION_ID;
  const eventIds = options.eventIds ?? [DEFAULT_SYNC_EVENT_ID];
  const token = options.token ?? defaultToken(options.edgeId);

  await database.query(
    `INSERT INTO organisations(id,name,lifecycle)
     VALUES ($1,$2,'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [organisationId, `Sync test organisation ${organisationId.slice(0, 8)}`],
  );

  for (const eventId of eventIds) {
    await database.query(
      `INSERT INTO events(id,organisation_id,name,timezone,lifecycle,starts_at,ends_at)
       VALUES ($1,$2,$3,'Africa/Nairobi','ACTIVE','2026-08-14T12:00:00Z','2026-08-15T12:00:00Z')
       ON CONFLICT (id) DO NOTHING`,
      [eventId, organisationId, `Sync test event ${eventId.slice(0, 8)}`],
    );
    const rows = await database.query<{ organisation_id: string }>(
      'SELECT organisation_id::text FROM events WHERE id=$1',
      [eventId],
    );
    if (rows[0]?.organisation_id !== organisationId) {
      throw new Error(`test event ${eventId} belongs to another organisation`);
    }
  }

  await database.query(
    `INSERT INTO edge_sync_clients(
       edge_id,organisation_id,credential_sha256,credential_version,status,revoked_at
     ) VALUES ($1,$2,$3,1,'ACTIVE',NULL)
     ON CONFLICT (edge_id) DO UPDATE SET
       organisation_id=EXCLUDED.organisation_id,
       credential_sha256=EXCLUDED.credential_sha256,
       credential_version=edge_sync_clients.credential_version+1,
       status='ACTIVE',
       revoked_at=NULL,
       updated_at=now(),
       last_authenticated_at=NULL`,
    [options.edgeId, organisationId, digest(token)],
  );

  return {
    organisationId,
    token,
    headers: syncEdgeHeaders(options.edgeId, token),
  };
}

export async function revokeSyncEdge(database: DatabaseService, edgeId: string): Promise<void> {
  await database.query(
    `UPDATE edge_sync_clients
     SET status='REVOKED',revoked_at=now(),updated_at=now()
     WHERE edge_id=$1`,
    [edgeId],
  );
}
