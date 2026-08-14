import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  canonicalSecurityJson,
  parseAuthorizationCredential,
  verifyCredentialSecret,
} from '@event-commerce/domain';
import type {
  AuthenticatedDevicePrincipal,
  AuthenticatedOperatorPrincipal,
  EdgeSecuritySnapshot,
  SignedEdgeSecuritySnapshot,
} from '@event-commerce/contracts';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import { EdgeDatabaseService } from '../database/database.service';

interface SnapshotStateRow extends QueryResultRow {
  event_id: string;
  organisation_id: string;
  version: string;
  generated_at: Date | string;
  installed_at: Date | string;
}

interface OperatorRow extends QueryResultRow {
  credential_id: string;
  event_id: string;
  organisation_id: string;
  actor_id: string;
  role: 'ADMIN' | 'PLATFORM_ADMIN';
  secret_hash: string;
  expires_at: Date | string;
}

interface DeviceRow extends QueryResultRow {
  credential_id: string;
  event_id: string;
  organisation_id: string;
  sales_location_id: string;
  device_id: string;
  secret_hash: string;
  expires_at: Date | string;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function validHash(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

function validSignature(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

function active(expiresAt: Date | string): boolean {
  return new Date(expiresAt).getTime() > Date.now();
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

@Injectable()
export class EdgeSecurityService {
  constructor(@Inject(EdgeDatabaseService) private readonly database: EdgeDatabaseService) {}

  async authenticateOperator(
    authorization: string | string[] | undefined,
  ): Promise<AuthenticatedOperatorPrincipal> {
    const parsed = this.parse(single(authorization), 'Bearer');
    const rows = await this.database.query<OperatorRow>(
      `SELECT credential_id::text,event_id,organisation_id,actor_id::text,role,
              secret_hash,expires_at
       FROM edge_security_operator_credentials WHERE credential_id=$1`,
      [parsed.credentialId],
    );
    const row = rows[0];
    if (!row || !active(row.expires_at)) {
      throw new UnauthorizedException('Operator credential is unknown or expired');
    }
    if (!verifyCredentialSecret(parsed.secret, row.secret_hash)) {
      throw new UnauthorizedException('Operator credential is invalid');
    }
    return {
      principalType: 'OPERATOR',
      credentialId: row.credential_id,
      actorId: row.actor_id,
      organisationId: row.organisation_id,
      role: row.role,
    };
  }

  async authenticateDevice(
    authorization: string | string[] | undefined,
  ): Promise<AuthenticatedDevicePrincipal> {
    const parsed = this.parse(single(authorization), 'Device');
    const rows = await this.database.query<DeviceRow>(
      `SELECT credential_id::text,event_id,organisation_id,sales_location_id,device_id,
              secret_hash,expires_at
       FROM edge_security_device_credentials WHERE credential_id=$1`,
      [parsed.credentialId],
    );
    const row = rows[0];
    if (!row || !active(row.expires_at)) {
      throw new UnauthorizedException('Device credential is unknown or expired');
    }
    if (!verifyCredentialSecret(parsed.secret, row.secret_hash)) {
      throw new UnauthorizedException('Device credential is invalid');
    }
    return {
      principalType: 'DEVICE',
      credentialId: row.credential_id,
      organisationId: row.organisation_id,
      eventId: row.event_id,
      salesLocationId: row.sales_location_id,
      deviceId: row.device_id,
    };
  }

  async installSnapshot(value: unknown): Promise<{
    eventId: string;
    organisationId: string;
    version: number;
    operatorCredentials: number;
    deviceCredentials: number;
  }> {
    const signed = this.parseSnapshot(value);
    this.verifySignature(signed);
    this.validateSnapshot(signed.snapshot);

    return this.database.transaction(async (client) => {
      const snapshot = signed.snapshot;
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `edge-security-snapshot:${snapshot.eventId}`,
      ]);
      const current = await client.query<SnapshotStateRow>(
        `SELECT event_id,organisation_id,version::text,generated_at,installed_at
         FROM edge_security_snapshot_state WHERE event_id=$1 FOR UPDATE`,
        [snapshot.eventId],
      );
      const existing = current.rows[0];
      if (existing && snapshot.version <= Number(existing.version)) {
        throw new ConflictException('Security snapshot version rollback/replay is not allowed');
      }
      if (existing && existing.organisation_id !== snapshot.organisationId) {
        throw new ForbiddenException('Security snapshot organisation does not match installed event');
      }

      await client.query(
        `INSERT INTO edge_security_snapshot_state(
           event_id,organisation_id,version,generated_at,installed_at
         ) VALUES ($1,$2,$3,$4,now())
         ON CONFLICT(event_id) DO UPDATE SET
           organisation_id=excluded.organisation_id,
           version=excluded.version,
           generated_at=excluded.generated_at,
           installed_at=now()`,
        [snapshot.eventId, snapshot.organisationId, snapshot.version, snapshot.generatedAt],
      );
      await client.query(
        `DELETE FROM edge_security_operator_credentials WHERE event_id=$1`,
        [snapshot.eventId],
      );
      await client.query(
        `DELETE FROM edge_security_device_credentials WHERE event_id=$1`,
        [snapshot.eventId],
      );
      for (const operator of snapshot.operators) {
        await this.insertOperator(client, snapshot.eventId, operator);
      }
      for (const device of snapshot.devices) {
        await this.insertDevice(client, device);
      }
      return {
        eventId: snapshot.eventId,
        organisationId: snapshot.organisationId,
        version: snapshot.version,
        operatorCredentials: snapshot.operators.length,
        deviceCredentials: snapshot.devices.length,
      };
    });
  }

  async status(): Promise<
    Array<{
      eventId: string;
      organisationId: string;
      version: number;
      generatedAt: string;
      installedAt: string;
    }>
  > {
    const rows = await this.database.query<SnapshotStateRow>(
      `SELECT event_id,organisation_id,version::text,generated_at,installed_at
       FROM edge_security_snapshot_state ORDER BY event_id`,
    );
    return rows.map((row) => ({
      eventId: row.event_id,
      organisationId: row.organisation_id,
      version: Number(row.version),
      generatedAt: iso(row.generated_at),
      installedAt: iso(row.installed_at),
    }));
  }

  private parse(value: string | undefined, scheme: string) {
    try {
      return parseAuthorizationCredential(value, scheme);
    } catch {
      throw new UnauthorizedException('Authorization credential is invalid');
    }
  }

  private parseSnapshot(value: unknown): SignedEdgeSecuritySnapshot {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new UnauthorizedException('Signed security snapshot must be an object');
    }
    const record = value as Record<string, unknown>;
    if (!record.snapshot || typeof record.snapshot !== 'object' || Array.isArray(record.snapshot)) {
      throw new UnauthorizedException('Signed security snapshot is missing snapshot payload');
    }
    if (typeof record.signature !== 'string' || !validSignature(record.signature)) {
      throw new UnauthorizedException('Signed security snapshot signature is invalid');
    }
    return {
      snapshot: record.snapshot as EdgeSecuritySnapshot,
      signature: record.signature,
    };
  }

  private verifySignature(signed: SignedEdgeSecuritySnapshot): void {
    const secret = process.env.EDGE_SECURITY_SNAPSHOT_SECRET;
    if (!secret || secret.length < 32) {
      throw new ForbiddenException('Event Edge security snapshot verification is not configured');
    }
    const expected = createHmac('sha256', secret)
      .update(canonicalSecurityJson(signed.snapshot))
      .digest();
    const actual = Buffer.from(signed.signature, 'hex');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new UnauthorizedException('Security snapshot signature verification failed');
    }
  }

  private validateSnapshot(snapshot: EdgeSecuritySnapshot): void {
    if (snapshot.schemaVersion !== 1) throw new UnauthorizedException('Unsupported security snapshot schema');
    if (!Number.isSafeInteger(snapshot.version) || snapshot.version <= 0) {
      throw new UnauthorizedException('Security snapshot version must be a positive safe integer');
    }
    if (!snapshot.organisationId?.trim() || !snapshot.eventId?.trim()) {
      throw new UnauthorizedException('Security snapshot scope is invalid');
    }
    if (!Number.isFinite(Date.parse(snapshot.generatedAt))) {
      throw new UnauthorizedException('Security snapshot generatedAt is invalid');
    }
    if (!Array.isArray(snapshot.operators) || !Array.isArray(snapshot.devices)) {
      throw new UnauthorizedException('Security snapshot credential lists are invalid');
    }
    const ids = new Set<string>();
    for (const operator of snapshot.operators) {
      if (ids.has(operator.credentialId)) throw new UnauthorizedException('Security snapshot repeats credential ID');
      ids.add(operator.credentialId);
      if (
        operator.organisationId !== snapshot.organisationId ||
        !operator.actorId?.trim() ||
        !['ADMIN', 'PLATFORM_ADMIN'].includes(operator.role) ||
        !validHash(operator.secretHash) ||
        !Number.isFinite(Date.parse(operator.expiresAt)) ||
        new Date(operator.expiresAt).getTime() <= Date.now()
      ) {
        throw new UnauthorizedException('Security snapshot contains invalid operator credential');
      }
    }
    for (const device of snapshot.devices) {
      if (ids.has(device.credentialId)) throw new UnauthorizedException('Security snapshot repeats credential ID');
      ids.add(device.credentialId);
      if (
        device.organisationId !== snapshot.organisationId ||
        device.eventId !== snapshot.eventId ||
        !device.salesLocationId?.trim() ||
        !device.deviceId?.trim() ||
        !validHash(device.secretHash) ||
        !Number.isFinite(Date.parse(device.expiresAt)) ||
        new Date(device.expiresAt).getTime() <= Date.now()
      ) {
        throw new UnauthorizedException('Security snapshot contains invalid device credential');
      }
    }
  }

  private async insertOperator(
    client: PoolClient,
    eventId: string,
    operator: EdgeSecuritySnapshot['operators'][number],
  ): Promise<void> {
    await client.query(
      `INSERT INTO edge_security_operator_credentials(
         credential_id,event_id,organisation_id,actor_id,role,secret_hash,expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        operator.credentialId,
        eventId,
        operator.organisationId,
        operator.actorId,
        operator.role,
        operator.secretHash,
        operator.expiresAt,
      ],
    );
  }

  private async insertDevice(
    client: PoolClient,
    device: EdgeSecuritySnapshot['devices'][number],
  ): Promise<void> {
    await client.query(
      `INSERT INTO edge_security_device_credentials(
         credential_id,event_id,organisation_id,sales_location_id,device_id,secret_hash,expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        device.credentialId,
        device.eventId,
        device.organisationId,
        device.salesLocationId,
        device.deviceId,
        device.secretHash,
        device.expiresAt,
      ],
    );
  }
}
