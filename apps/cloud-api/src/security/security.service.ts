import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  canonicalSecurityJson,
  issueOpaqueCredential,
  parseAuthorizationCredential,
  verifyCredentialSecret,
} from '@event-commerce/domain';
import type {
  AuthenticatedEdgePrincipal,
  AuthenticatedOperatorPrincipal,
  EdgeSecuritySnapshot,
  IssuedDeviceCredential,
  IssuedEdgeCredential,
  IssuedOperatorCredential,
  SecurityDeviceSnapshotEntry,
  SecurityOperatorSnapshotEntry,
  SignedEdgeSecuritySnapshot,
} from '@event-commerce/contracts';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import {
  assertOrganisationAccess,
  type AdminContext,
} from '../configuration/admin-context';
import { DatabaseService } from '../database/database.service';
import type {
  BootstrapOperatorInput,
  CredentialMutationInput,
  ProvisionDeviceInput,
  ProvisionEdgeInput,
  ProvisionOperatorInput,
} from './security.validation';

interface OperatorRow extends QueryResultRow {
  id: string;
  organisation_id: string;
  actor_id: string;
  role: 'ADMIN' | 'PLATFORM_ADMIN';
  secret_hash: string;
  label: string;
  expires_at: Date | string;
  revoked_at: Date | string | null;
}

interface DeviceRow extends QueryResultRow {
  id: string;
  organisation_id: string;
  event_id: string;
  sales_location_id: string;
  device_id: string;
  secret_hash: string;
  label: string;
  expires_at: Date | string;
  revoked_at: Date | string | null;
}

interface EdgeRow extends QueryResultRow {
  id: string;
  organisation_id: string;
  event_id: string;
  edge_id: string;
  secret_hash: string;
  label: string;
  expires_at: Date | string;
  revoked_at: Date | string | null;
}

interface EventRow extends QueryResultRow {
  id: string;
  organisation_id: string;
}

interface VersionRow extends QueryResultRow {
  version: string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function expiresAt(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function authorizationValue(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function active(expires: Date | string, revoked: Date | string | null): boolean {
  return revoked === null && new Date(expires).getTime() > Date.now();
}

@Injectable()
export class CloudSecurityService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async authenticateOperator(
    authorization: string | string[] | undefined,
  ): Promise<AuthenticatedOperatorPrincipal> {
    const parsed = this.parseCredential(authorizationValue(authorization), 'Bearer');
    const rows = await this.database.query<OperatorRow>(
      `SELECT id::text,organisation_id::text,actor_id::text,role,secret_hash,label,
              expires_at,revoked_at
       FROM security_operator_credentials WHERE id=$1`,
      [parsed.credentialId],
    );
    const row = rows[0];
    if (!row || !active(row.expires_at, row.revoked_at)) {
      throw new UnauthorizedException('Operator credential is unknown, expired or revoked');
    }
    if (!verifyCredentialSecret(parsed.secret, row.secret_hash)) {
      throw new UnauthorizedException('Operator credential is invalid');
    }
    return {
      principalType: 'OPERATOR',
      credentialId: row.id,
      actorId: row.actor_id,
      organisationId: row.organisation_id,
      role: row.role,
    };
  }

  async authenticateEdge(
    authorization: string | string[] | undefined,
  ): Promise<AuthenticatedEdgePrincipal> {
    const parsed = this.parseCredential(authorizationValue(authorization), 'Edge');
    const rows = await this.database.query<EdgeRow>(
      `SELECT id::text,organisation_id::text,event_id::text,edge_id,secret_hash,label,
              expires_at,revoked_at
       FROM security_edge_credentials WHERE id=$1`,
      [parsed.credentialId],
    );
    const row = rows[0];
    if (!row || !active(row.expires_at, row.revoked_at)) {
      throw new UnauthorizedException('Event Edge credential is unknown, expired or revoked');
    }
    if (!verifyCredentialSecret(parsed.secret, row.secret_hash)) {
      throw new UnauthorizedException('Event Edge credential is invalid');
    }
    return {
      principalType: 'EDGE_SERVICE',
      credentialId: row.id,
      organisationId: row.organisation_id,
      eventId: row.event_id,
      edgeId: row.edge_id,
    };
  }

  async bootstrapOperator(
    bootstrapSecret: string | string[] | undefined,
    input: BootstrapOperatorInput,
  ): Promise<IssuedOperatorCredential> {
    this.requireBootstrapSecret(authorizationValue(bootstrapSecret));
    return this.database.transaction(async (client) => {
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext('event-commerce-security-bootstrap'))`,
      );
      const existing = await client.query(
        `SELECT 1 FROM security_operator_credentials LIMIT 1`,
      );
      if (existing.rowCount !== 0) {
        throw new ConflictException('Security bootstrap is already complete');
      }
      await this.requireOrganisation(client, input.organisationId);
      const issued = issueOpaqueCredential();
      const expiration = expiresAt(input.expiresInMinutes);
      await client.query(
        `INSERT INTO security_operator_credentials(
           id,organisation_id,actor_id,role,secret_hash,label,expires_at,created_by_actor_id
         ) VALUES ($1,$2,$3,'ADMIN',$4,$5,$6,$3)`,
        [
          issued.credentialId,
          input.organisationId,
          input.actorId,
          issued.secretHash,
          input.label,
          expiration,
        ],
      );
      await this.audit(client, {
        organisationId: input.organisationId,
        actorId: input.actorId,
        action: 'SECURITY_BOOTSTRAP_OPERATOR_CREATED',
        entityType: 'SECURITY_OPERATOR_CREDENTIAL',
        entityId: issued.credentialId,
        changes: { role: 'ADMIN', label: input.label, expiresAt: expiration },
      });
      return {
        credentialId: issued.credentialId,
        token: issued.token,
        actorId: input.actorId,
        organisationId: input.organisationId,
        role: 'ADMIN',
        label: input.label,
        expiresAt: expiration,
      };
    });
  }

  async provisionOperator(
    context: AdminContext,
    input: ProvisionOperatorInput,
  ): Promise<IssuedOperatorCredential> {
    assertOrganisationAccess(context, input.organisationId);
    if (input.role === 'PLATFORM_ADMIN' && context.role !== 'PLATFORM_ADMIN') {
      throw new ForbiddenException('Only a platform administrator may provision PLATFORM_ADMIN');
    }
    const issued = issueOpaqueCredential();
    const expiration = expiresAt(input.expiresInMinutes);
    await this.database.transaction(async (client) => {
      await this.requireOrganisation(client, input.organisationId);
      await client.query(
        `INSERT INTO security_operator_credentials(
           id,organisation_id,actor_id,role,secret_hash,label,expires_at,created_by_actor_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          issued.credentialId,
          input.organisationId,
          input.actorId,
          input.role,
          issued.secretHash,
          input.label,
          expiration,
          context.actorId,
        ],
      );
      await this.audit(client, {
        organisationId: input.organisationId,
        actorId: context.actorId,
        action: 'SECURITY_OPERATOR_CREDENTIAL_CREATED',
        entityType: 'SECURITY_OPERATOR_CREDENTIAL',
        entityId: issued.credentialId,
        changes: {
          actorId: input.actorId,
          role: input.role,
          label: input.label,
          expiresAt: expiration,
        },
      });
    });
    return {
      credentialId: issued.credentialId,
      token: issued.token,
      actorId: input.actorId,
      organisationId: input.organisationId,
      role: input.role,
      label: input.label,
      expiresAt: expiration,
    };
  }

  async provisionDevice(
    context: AdminContext,
    eventId: string,
    input: ProvisionDeviceInput,
  ): Promise<IssuedDeviceCredential> {
    const event = await this.event(eventId);
    assertOrganisationAccess(context, event.organisation_id);
    await this.requireSalesLocation(event.organisation_id, eventId, input.salesLocationId);
    const issued = issueOpaqueCredential();
    const expiration = expiresAt(input.expiresInMinutes);
    await this.database.transaction(async (client) => {
      await client.query(
        `INSERT INTO security_device_credentials(
           id,organisation_id,event_id,sales_location_id,device_id,secret_hash,label,
           expires_at,created_by_actor_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          issued.credentialId,
          event.organisation_id,
          eventId,
          input.salesLocationId,
          input.deviceId,
          issued.secretHash,
          input.label,
          expiration,
          context.actorId,
        ],
      );
      await this.audit(client, {
        organisationId: event.organisation_id,
        actorId: context.actorId,
        action: 'SECURITY_DEVICE_CREDENTIAL_CREATED',
        entityType: 'SECURITY_DEVICE_CREDENTIAL',
        entityId: issued.credentialId,
        changes: {
          eventId,
          deviceId: input.deviceId,
          salesLocationId: input.salesLocationId,
          label: input.label,
          expiresAt: expiration,
        },
      });
    });
    return {
      credentialId: issued.credentialId,
      token: issued.token,
      organisationId: event.organisation_id,
      eventId,
      salesLocationId: input.salesLocationId,
      deviceId: input.deviceId,
      label: input.label,
      expiresAt: expiration,
    };
  }

  async provisionEdge(
    context: AdminContext,
    eventId: string,
    input: ProvisionEdgeInput,
  ): Promise<IssuedEdgeCredential> {
    const event = await this.event(eventId);
    assertOrganisationAccess(context, event.organisation_id);
    const issued = issueOpaqueCredential();
    const expiration = expiresAt(input.expiresInMinutes);
    await this.database.transaction(async (client) => {
      await client.query(
        `INSERT INTO security_edge_credentials(
           id,organisation_id,event_id,edge_id,secret_hash,label,expires_at,created_by_actor_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          issued.credentialId,
          event.organisation_id,
          eventId,
          input.edgeId,
          issued.secretHash,
          input.label,
          expiration,
          context.actorId,
        ],
      );
      await this.audit(client, {
        organisationId: event.organisation_id,
        actorId: context.actorId,
        action: 'SECURITY_EDGE_CREDENTIAL_CREATED',
        entityType: 'SECURITY_EDGE_CREDENTIAL',
        entityId: issued.credentialId,
        changes: { eventId, edgeId: input.edgeId, label: input.label, expiresAt: expiration },
      });
    });
    return {
      credentialId: issued.credentialId,
      token: issued.token,
      organisationId: event.organisation_id,
      eventId,
      edgeId: input.edgeId,
      label: input.label,
      expiresAt: expiration,
    };
  }

  async revokeCredential(
    context: AdminContext,
    kind: 'operator' | 'device' | 'edge',
    credentialId: string,
    input: CredentialMutationInput,
  ): Promise<{ credentialId: string; revoked: true }> {
    return this.database.transaction(async (client) => {
      const target = await this.loadCredential(client, kind, credentialId, true);
      assertOrganisationAccess(context, target.organisationId);
      if (target.revokedAt !== null) return { credentialId, revoked: true as const };
      await client.query(
        `UPDATE ${this.table(kind)} SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL`,
        [credentialId],
      );
      await this.audit(client, {
        organisationId: target.organisationId,
        actorId: context.actorId,
        action: `SECURITY_${kind.toUpperCase()}_CREDENTIAL_REVOKED`,
        entityType: `SECURITY_${kind.toUpperCase()}_CREDENTIAL`,
        entityId: credentialId,
        changes: { reason: input.reason },
      });
      return { credentialId, revoked: true as const };
    });
  }

  async rotateCredential(
    context: AdminContext,
    kind: 'operator' | 'device' | 'edge',
    credentialId: string,
    input: CredentialMutationInput,
  ): Promise<IssuedOperatorCredential | IssuedDeviceCredential | IssuedEdgeCredential> {
    const minutes = input.expiresInMinutes ?? (kind === 'operator' ? 720 : 43_200);
    if (kind === 'operator' && minutes > 1_440) {
      throw new ConflictException('Operator credentials cannot exceed 1440 minutes');
    }
    return this.database.transaction(async (client) => {
      const target = await this.loadCredential(client, kind, credentialId, true);
      assertOrganisationAccess(context, target.organisationId);
      if (target.revokedAt !== null) throw new ConflictException('Revoked credential cannot rotate');
      const issued = issueOpaqueCredential();
      const expiration = expiresAt(minutes);

      if (kind === 'operator') {
        const row = target.row as OperatorRow;
        await client.query(
          `INSERT INTO security_operator_credentials(
             id,organisation_id,actor_id,role,secret_hash,label,expires_at,created_by_actor_id,
             rotated_from_id
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            issued.credentialId,
            row.organisation_id,
            row.actor_id,
            row.role,
            issued.secretHash,
            row.label,
            expiration,
            context.actorId,
            credentialId,
          ],
        );
        await this.revokeForRotation(client, kind, credentialId);
        await this.auditRotation(client, target.organisationId, context.actorId, kind, credentialId, issued.credentialId, input.reason);
        return {
          credentialId: issued.credentialId,
          token: issued.token,
          actorId: row.actor_id,
          organisationId: row.organisation_id,
          role: row.role,
          label: row.label,
          expiresAt: expiration,
        };
      }

      if (kind === 'device') {
        const row = target.row as DeviceRow;
        await client.query(
          `INSERT INTO security_device_credentials(
             id,organisation_id,event_id,sales_location_id,device_id,secret_hash,label,
             expires_at,created_by_actor_id,rotated_from_id
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            issued.credentialId,
            row.organisation_id,
            row.event_id,
            row.sales_location_id,
            row.device_id,
            issued.secretHash,
            row.label,
            expiration,
            context.actorId,
            credentialId,
          ],
        );
        await this.revokeForRotation(client, kind, credentialId);
        await this.auditRotation(client, target.organisationId, context.actorId, kind, credentialId, issued.credentialId, input.reason);
        return {
          credentialId: issued.credentialId,
          token: issued.token,
          organisationId: row.organisation_id,
          eventId: row.event_id,
          salesLocationId: row.sales_location_id,
          deviceId: row.device_id,
          label: row.label,
          expiresAt: expiration,
        };
      }

      const row = target.row as EdgeRow;
      await client.query(
        `INSERT INTO security_edge_credentials(
           id,organisation_id,event_id,edge_id,secret_hash,label,expires_at,created_by_actor_id,
           rotated_from_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          issued.credentialId,
          row.organisation_id,
          row.event_id,
          row.edge_id,
          issued.secretHash,
          row.label,
          expiration,
          context.actorId,
          credentialId,
        ],
      );
      await this.revokeForRotation(client, kind, credentialId);
      await this.auditRotation(client, target.organisationId, context.actorId, kind, credentialId, issued.credentialId, input.reason);
      return {
        credentialId: issued.credentialId,
        token: issued.token,
        organisationId: row.organisation_id,
        eventId: row.event_id,
        edgeId: row.edge_id,
        label: row.label,
        expiresAt: expiration,
      };
    });
  }

  async edgeSnapshot(
    context: AdminContext,
    eventId: string,
  ): Promise<SignedEdgeSecuritySnapshot> {
    const event = await this.event(eventId);
    assertOrganisationAccess(context, event.organisation_id);
    const [operators, devices, versions] = await Promise.all([
      this.database.query<OperatorRow>(
        `SELECT id::text,organisation_id::text,actor_id::text,role,secret_hash,label,
                expires_at,revoked_at
         FROM security_operator_credentials
         WHERE organisation_id=$1 AND revoked_at IS NULL AND expires_at>now()
         ORDER BY id`,
        [event.organisation_id],
      ),
      this.database.query<DeviceRow>(
        `SELECT id::text,organisation_id::text,event_id::text,sales_location_id::text,
                device_id,secret_hash,label,expires_at,revoked_at
         FROM security_device_credentials
         WHERE event_id=$1 AND revoked_at IS NULL AND expires_at>now()
         ORDER BY id`,
        [eventId],
      ),
      this.database.query<VersionRow>(
        `SELECT nextval('security_snapshot_version_seq')::text AS version`,
      ),
    ]);
    const snapshot: EdgeSecuritySnapshot = {
      schemaVersion: 1,
      version: Number(versions[0]?.version ?? '0'),
      generatedAt: new Date().toISOString(),
      organisationId: event.organisation_id,
      eventId,
      operators: operators.map((row): SecurityOperatorSnapshotEntry => ({
        credentialId: row.id,
        actorId: row.actor_id,
        organisationId: row.organisation_id,
        role: row.role,
        secretHash: row.secret_hash,
        expiresAt: iso(row.expires_at),
      })),
      devices: devices.map((row): SecurityDeviceSnapshotEntry => ({
        credentialId: row.id,
        organisationId: row.organisation_id,
        eventId: row.event_id,
        salesLocationId: row.sales_location_id,
        deviceId: row.device_id,
        secretHash: row.secret_hash,
        expiresAt: iso(row.expires_at),
      })),
    };
    const signingSecret = this.runtimeSecret('EDGE_SECURITY_SNAPSHOT_SECRET');
    return {
      snapshot,
      signature: createHmac('sha256', signingSecret)
        .update(canonicalSecurityJson(snapshot))
        .digest('hex'),
    };
  }

  edgeContext(principal: AuthenticatedEdgePrincipal): AuthenticatedEdgePrincipal {
    return principal;
  }

  private parseCredential(value: string | undefined, scheme: string) {
    try {
      return parseAuthorizationCredential(value, scheme);
    } catch {
      throw new UnauthorizedException('Authorization credential is invalid');
    }
  }

  private requireBootstrapSecret(actual: string | undefined): void {
    const expected = process.env.SECURITY_BOOTSTRAP_SECRET;
    if (!expected || expected.length < 24) {
      throw new ForbiddenException('Security bootstrap is disabled');
    }
    if (!actual) throw new UnauthorizedException('Security bootstrap secret is required');
    const actualHash = createHash('sha256').update(actual).digest();
    const expectedHash = createHash('sha256').update(expected).digest();
    if (!timingSafeEqual(actualHash, expectedHash)) {
      throw new UnauthorizedException('Security bootstrap secret is invalid');
    }
  }

  private runtimeSecret(name: string): string {
    const value = process.env[name];
    if (!value || value.length < 32) throw new Error(`${name} must contain at least 32 characters`);
    return value;
  }

  private async event(eventId: string): Promise<EventRow> {
    const rows = await this.database.query<EventRow>(
      `SELECT id::text,organisation_id::text FROM events WHERE id=$1`,
      [eventId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('Event not found');
    return row;
  }

  private async requireOrganisation(client: PoolClient, organisationId: string): Promise<void> {
    const result = await client.query(`SELECT 1 FROM organisations WHERE id=$1`, [organisationId]);
    if (result.rowCount !== 1) throw new NotFoundException('Organisation not found');
  }

  private async requireSalesLocation(
    organisationId: string,
    eventId: string,
    salesLocationId: string,
  ): Promise<void> {
    const rows = await this.database.query(
      `SELECT 1 FROM sales_locations
       WHERE id=$1 AND event_id=$2 AND organisation_id=$3 AND lifecycle='ACTIVE'`,
      [salesLocationId, eventId, organisationId],
    );
    if (rows.length !== 1) {
      throw new NotFoundException('Active sales location not found for event');
    }
  }

  private table(kind: 'operator' | 'device' | 'edge'): string {
    if (kind === 'operator') return 'security_operator_credentials';
    if (kind === 'device') return 'security_device_credentials';
    return 'security_edge_credentials';
  }

  private async loadCredential(
    client: PoolClient,
    kind: 'operator' | 'device' | 'edge',
    credentialId: string,
    lock: boolean,
  ): Promise<{
    organisationId: string;
    revokedAt: Date | string | null;
    row: OperatorRow | DeviceRow | EdgeRow;
  }> {
    const table = this.table(kind);
    const eventColumns =
      kind === 'operator'
        ? `actor_id::text,role`
        : kind === 'device'
          ? `event_id::text,sales_location_id::text,device_id`
          : `event_id::text,edge_id`;
    const result = await client.query<OperatorRow | DeviceRow | EdgeRow>(
      `SELECT id::text,organisation_id::text,${eventColumns},secret_hash,label,
              expires_at,revoked_at
       FROM ${table} WHERE id=$1${lock ? ' FOR UPDATE' : ''}`,
      [credentialId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException('Security credential not found');
    return {
      organisationId: row.organisation_id,
      revokedAt: row.revoked_at,
      row,
    };
  }

  private async revokeForRotation(
    client: PoolClient,
    kind: 'operator' | 'device' | 'edge',
    credentialId: string,
  ): Promise<void> {
    await client.query(
      `UPDATE ${this.table(kind)} SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL`,
      [credentialId],
    );
  }

  private async auditRotation(
    client: PoolClient,
    organisationId: string,
    actorId: string,
    kind: 'operator' | 'device' | 'edge',
    oldId: string,
    newId: string,
    reason: string,
  ): Promise<void> {
    await this.audit(client, {
      organisationId,
      actorId,
      action: `SECURITY_${kind.toUpperCase()}_CREDENTIAL_ROTATED`,
      entityType: `SECURITY_${kind.toUpperCase()}_CREDENTIAL`,
      entityId: newId,
      changes: { rotatedFromCredentialId: oldId, reason },
    });
  }

  private async audit(
    client: PoolClient,
    input: {
      organisationId: string;
      actorId: string;
      action: string;
      entityType: string;
      entityId: string;
      changes: Record<string, unknown>;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_events(
         id,organisation_id,actor_id,action,entity_type,entity_id,changes
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [
        randomUUID(),
        input.organisationId,
        input.actorId,
        input.action,
        input.entityType,
        input.entityId,
        JSON.stringify(input.changes),
      ],
    );
  }
}
