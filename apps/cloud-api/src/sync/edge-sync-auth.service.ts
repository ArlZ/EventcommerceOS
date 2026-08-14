import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { EdgeCloudBatch } from '@event-commerce/contracts';
import type { QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';

export interface EdgeSyncIdentity {
  edgeId: string;
  organisationId: string;
  credentialVersion: number;
}

interface EdgeClientRow extends QueryResultRow {
  edge_id: string;
  organisation_id: string;
  credential_sha256: string;
  credential_version: number;
  status: 'ACTIVE' | 'REVOKED';
}

interface EventOrgRow extends QueryResultRow {
  id: string;
}

type HeadersRecord = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function bearer(headers: HeadersRecord): string {
  const authorization = first(headers.authorization);
  if (!authorization?.startsWith('Bearer ')) {
    throw new UnauthorizedException('Event Edge bearer credential required');
  }
  const value = authorization.slice('Bearer '.length).trim();
  if (value.length < 32 || value.length > 512) {
    throw new UnauthorizedException('Event Edge bearer credential is invalid');
  }
  return value;
}

function edgeId(headers: HeadersRecord): string {
  const value = first(headers['x-edge-id'])?.trim();
  if (!value || value.length > 200) {
    throw new UnauthorizedException('x-edge-id is required');
  }
  return value;
}

function hashCredential(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function eventIdFromPayload(event: EdgeCloudBatch['events'][number]): string {
  const value = event.payload.eventId;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(
      `sync event ${event.eventInstanceId} must include payload.eventId for tenant binding`,
    );
  }
  return value.trim();
}

@Injectable()
export class EdgeSyncAuthService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async authenticate(headers: HeadersRecord): Promise<EdgeSyncIdentity> {
    const requestedEdgeId = edgeId(headers);
    const token = bearer(headers);
    const rows = await this.database.query<EdgeClientRow>(
      `SELECT edge_id,organisation_id::text,credential_sha256,credential_version,status
       FROM edge_sync_clients WHERE edge_id=$1`,
      [requestedEdgeId],
    );
    const row = rows[0];
    if (!row || row.status !== 'ACTIVE') {
      throw new UnauthorizedException('Event Edge credential is not active');
    }

    const actual = hashCredential(token);
    const expected = Buffer.from(row.credential_sha256, 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new UnauthorizedException('Event Edge credential is invalid');
    }

    await this.database.query(
      `UPDATE edge_sync_clients SET last_authenticated_at=now()
       WHERE edge_id=$1 AND credential_version=$2 AND status='ACTIVE'`,
      [row.edge_id, row.credential_version],
    );

    return {
      edgeId: row.edge_id,
      organisationId: row.organisation_id,
      credentialVersion: row.credential_version,
    };
  }

  async authorizeBatch(identity: EdgeSyncIdentity, batch: EdgeCloudBatch): Promise<void> {
    if (batch.edgeId !== identity.edgeId) {
      throw new UnauthorizedException('Batch edgeId does not match authenticated Event Edge');
    }

    const eventIds = [...new Set(batch.events.map(eventIdFromPayload))];
    if (eventIds.length > 0) {
      const rows = await this.database.query<EventOrgRow>(
        `SELECT id::text FROM events
         WHERE organisation_id=$1 AND id::text = ANY($2::text[])`,
        [identity.organisationId, eventIds],
      );
      const allowed = new Set(rows.map((row) => row.id));
      const denied = eventIds.find((id) => !allowed.has(id));
      if (denied) {
        throw new UnauthorizedException('Sync batch contains an event outside the Event Edge organisation');
      }
    }

    const eventDeviceIds = new Set(batch.events.map((event) => event.deviceId));
    const unexpectedStatus = batch.deviceStatuses.find(
      (status) => !eventDeviceIds.has(status.deviceId),
    );
    if (unexpectedStatus) {
      throw new BadRequestException(
        'Device status may only be supplied for a device represented in the authenticated sync batch',
      );
    }
  }
}
