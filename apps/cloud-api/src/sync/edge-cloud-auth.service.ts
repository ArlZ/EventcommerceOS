import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { EdgeCloudBatch, InventoryEdgeBatch } from '@event-commerce/contracts';
import type { QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';

export interface EdgeCloudIdentity {
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

interface SalesLocationScopeRow extends QueryResultRow {
  id: string;
  event_id: string;
}

type HeadersRecord = Record<string, string | string[] | undefined>;
type TenantBoundEvent = { id: string; payload: Record<string, unknown> };

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

function requestedEdgeId(headers: HeadersRecord): string {
  const value = first(headers['x-edge-id'])?.trim();
  if (!value || value.length > 200) {
    throw new UnauthorizedException('x-edge-id is required');
  }
  return value;
}

function hashCredential(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function eventIdFromPayload(event: TenantBoundEvent): string {
  const value = event.payload.eventId;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(
      `Edge event ${event.id} must include payload.eventId for tenant binding`,
    );
  }
  return value.trim();
}

@Injectable()
export class EdgeCloudAuthService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async authenticate(headers: HeadersRecord): Promise<EdgeCloudIdentity> {
    const edgeId = requestedEdgeId(headers);
    const token = bearer(headers);
    const rows = await this.database.query<EdgeClientRow>(
      `SELECT edge_id,organisation_id::text,credential_sha256,credential_version,status
       FROM edge_sync_clients WHERE edge_id=$1`,
      [edgeId],
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

    const touched = await this.database.query<{ edge_id: string }>(
      `UPDATE edge_sync_clients SET last_authenticated_at=now()
       WHERE edge_id=$1 AND credential_version=$2 AND status='ACTIVE'
       RETURNING edge_id`,
      [row.edge_id, row.credential_version],
    );
    if (touched.length !== 1) {
      throw new UnauthorizedException('Event Edge credential changed during authentication');
    }

    return {
      edgeId: row.edge_id,
      organisationId: row.organisation_id,
      credentialVersion: row.credential_version,
    };
  }

  async authorizeEventIds(identity: EdgeCloudIdentity, eventIds: readonly string[]): Promise<void> {
    const unique = [...new Set(eventIds.map((value) => value.trim()).filter(Boolean))];
    if (unique.length === 0) return;
    const rows = await this.database.query<EventOrgRow>(
      `SELECT id::text FROM events
       WHERE organisation_id=$1 AND id::text = ANY($2::text[])`,
      [identity.organisationId, unique],
    );
    const allowed = new Set(rows.map((row) => row.id));
    const denied = unique.find((id) => !allowed.has(id));
    if (denied) {
      throw new UnauthorizedException('Requested event is outside the Event Edge organisation');
    }
  }

  async authorizeSyncBatch(identity: EdgeCloudIdentity, batch: EdgeCloudBatch): Promise<void> {
    this.assertEdgeId(identity, batch.edgeId);
    await this.assertEventsBelongToOrganisation(
      identity,
      batch.events.map((event) => ({ id: event.eventInstanceId, payload: event.payload })),
    );

    const posDevices = batch.posDevices ?? [];
    await this.authorizeEventIds(
      identity,
      posDevices.map((device) => device.eventId),
    );
    await this.authorizeRosterLocations(identity, posDevices);

    const representedDeviceIds = new Set([
      ...batch.events.map((event) => event.deviceId),
      ...posDevices.map((device) => device.deviceId),
    ]);
    const unexpectedStatus = batch.deviceStatuses.find(
      (status) => !representedDeviceIds.has(status.deviceId),
    );
    if (unexpectedStatus) {
      throw new BadRequestException(
        'Device status may only be supplied for a device represented in the authenticated sync batch',
      );
    }
  }

  async authorizeInventoryBatch(
    identity: EdgeCloudIdentity,
    batch: InventoryEdgeBatch,
  ): Promise<void> {
    this.assertEdgeId(identity, batch.edgeId);
    await this.assertEventsBelongToOrganisation(identity, batch.events);
  }

  async attributeInventoryBatch(
    identity: EdgeCloudIdentity,
    batch: InventoryEdgeBatch,
  ): Promise<void> {
    const ids = batch.events.map((event) => event.id);
    if (ids.length === 0) return;
    await this.database.query(
      `UPDATE inventory_edge_events
       SET edge_id=$1,organisation_id=$2
       WHERE id = ANY($3::text[])
         AND edge_id IS NULL
         AND organisation_id IS NULL`,
      [identity.edgeId, identity.organisationId, ids],
    );
  }

  private async authorizeRosterLocations(
    identity: EdgeCloudIdentity,
    devices: NonNullable<EdgeCloudBatch['posDevices']>,
  ): Promise<void> {
    const assigned = devices.filter(
      (device): device is typeof device & { salesLocationId: string } =>
        device.salesLocationId !== null,
    );
    if (assigned.length === 0) return;

    const locationIds = [...new Set(assigned.map((device) => device.salesLocationId))];
    const rows = await this.database.query<SalesLocationScopeRow>(
      `SELECT id::text,event_id::text
       FROM sales_locations
       WHERE organisation_id=$1 AND id::text = ANY($2::text[])`,
      [identity.organisationId, locationIds],
    );
    const byId = new Map(rows.map((row) => [row.id, row.event_id]));
    const invalid = assigned.find(
      (device) => byId.get(device.salesLocationId) !== device.eventId,
    );
    if (invalid) {
      throw new UnauthorizedException(
        'POS device sales location is outside the authenticated Event Edge event scope',
      );
    }
  }

  private assertEdgeId(identity: EdgeCloudIdentity, bodyEdgeId: string): void {
    if (bodyEdgeId !== identity.edgeId) {
      throw new UnauthorizedException('Batch edgeId does not match authenticated Event Edge');
    }
  }

  private async assertEventsBelongToOrganisation(
    identity: EdgeCloudIdentity,
    events: TenantBoundEvent[],
  ): Promise<void> {
    const eventIds = [...new Set(events.map(eventIdFromPayload))];
    await this.authorizeEventIds(identity, eventIds);
  }
}
