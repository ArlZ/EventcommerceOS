import { ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import type { AdminContext } from '../configuration/admin-context';
import { DatabaseService } from '../database/database.service';

export type OperatorOrganisationRole = 'ADMIN' | 'FINANCE' | 'SUPERVISOR' | 'VIEWER';
export type OperatorRole = 'PLATFORM_ADMIN' | OperatorOrganisationRole;
export type HeadersRecord = Record<string, string | string[] | undefined>;

export interface OperatorIdentity {
  sessionId: string;
  actorId: string;
  platformAdmin: boolean;
}

interface SessionRow extends QueryResultRow {
  session_id: string;
  actor_id: string;
  platform_role: 'PLATFORM_ADMIN' | null;
}

interface MembershipRow extends QueryResultRow {
  role: OperatorOrganisationRole;
}

interface OrganisationRow extends QueryResultRow {
  organisation_id: string;
}

export interface LegacyOperatorProjection {
  actorId: string;
  organisationId?: string;
  role?: OperatorRole;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function uuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function bearer(headers: HeadersRecord): string {
  const authorization = first(headers.authorization);
  if (!authorization?.startsWith('Bearer ')) {
    throw new UnauthorizedException('Operator bearer session required');
  }
  const token = authorization.slice('Bearer '.length).trim();
  if (!token.startsWith('ecom_op_') || token.length < 48 || token.length > 256) {
    throw new UnauthorizedException('Operator bearer session is invalid');
  }
  return token;
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

@Injectable()
export class OperatorAuthService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  isOperatorAuthorization(headers: HeadersRecord): boolean {
    return first(headers.authorization)?.startsWith('Bearer ecom_op_') ?? false;
  }

  async authenticate(headers: HeadersRecord): Promise<OperatorIdentity> {
    const token = bearer(headers);
    const rows = await this.database.query<SessionRow>(
      `UPDATE operator_sessions session
       SET last_authenticated_at=now()
       FROM operator_identities identity
       WHERE session.token_sha256=$1
         AND session.actor_id=identity.id
         AND session.revoked_at IS NULL
         AND session.expires_at > now()
         AND identity.status='ACTIVE'
       RETURNING session.id::text AS session_id,
                 identity.id::text AS actor_id,
                 identity.platform_role`,
      [digest(token)],
    );
    const row = rows[0];
    if (!row) throw new UnauthorizedException('Operator session is expired, revoked or invalid');
    return {
      sessionId: row.session_id,
      actorId: row.actor_id,
      platformAdmin: row.platform_role === 'PLATFORM_ADMIN',
    };
  }

  async legacyProjection(headers: HeadersRecord): Promise<LegacyOperatorProjection> {
    const identity = await this.authenticate(headers);
    const organisationId = this.selectedOrganisation(headers, false);
    if (identity.platformAdmin) {
      return {
        actorId: identity.actorId,
        role: 'PLATFORM_ADMIN',
        ...(organisationId ? { organisationId } : {}),
      };
    }
    if (!organisationId) return { actorId: identity.actorId };
    const role = await this.membership(identity.actorId, organisationId);
    return {
      actorId: identity.actorId,
      organisationId,
      ...(role ? { role } : {}),
    };
  }

  async selectedAdminContext(
    headers: HeadersRecord,
    organisationRequired = true,
  ): Promise<AdminContext> {
    const identity = await this.authenticate(headers);
    const organisationId = this.selectedOrganisation(headers, organisationRequired);
    if (identity.platformAdmin) {
      return {
        actorId: identity.actorId,
        role: 'PLATFORM_ADMIN',
        ...(organisationId ? { organisationId } : {}),
      };
    }
    if (!organisationId) throw new UnauthorizedException('x-organisation-id is required');
    await this.requireRole(identity, organisationId, ['ADMIN']);
    return { actorId: identity.actorId, organisationId, role: 'ADMIN' };
  }

  async platformAdminContext(headers: HeadersRecord): Promise<AdminContext> {
    const identity = await this.authenticate(headers);
    if (!identity.platformAdmin) throw new ForbiddenException('Platform administrator required');
    return { actorId: identity.actorId, role: 'PLATFORM_ADMIN' };
  }

  async contextForOrganisation(
    headers: HeadersRecord,
    organisationId: string,
    allowedRoles: readonly OperatorOrganisationRole[],
  ): Promise<AdminContext> {
    const identity = await this.authenticate(headers);
    return this.authorizeOrganisation(identity, organisationId, allowedRoles);
  }

  async contextForEvent(
    headers: HeadersRecord,
    eventId: string,
    allowedRoles: readonly OperatorOrganisationRole[],
  ): Promise<AdminContext> {
    const identity = await this.authenticate(headers);
    if (!uuid(eventId)) throw new ForbiddenException('Event is unavailable to this operator');
    const organisationId = await this.organisationFor(
      `SELECT organisation_id::text AS organisation_id FROM events WHERE id=$1`,
      [eventId],
      'Event is unavailable to this operator',
    );
    return this.authorizeOrganisation(identity, organisationId, allowedRoles);
  }

  async contextForPayment(
    headers: HeadersRecord,
    paymentId: string,
    allowedRoles: readonly OperatorOrganisationRole[],
  ): Promise<AdminContext> {
    const identity = await this.authenticate(headers);
    const organisationId = await this.organisationFor(
      `SELECT event.organisation_id::text AS organisation_id
       FROM payments payment
       JOIN events event ON event.id::text=payment.event_id
       WHERE payment.id=$1`,
      [paymentId],
      'Payment is unavailable to this operator',
    );
    return this.authorizeOrganisation(identity, organisationId, allowedRoles);
  }

  async contextForPaymentAttempt(
    headers: HeadersRecord,
    paymentAttemptId: string,
    allowedRoles: readonly OperatorOrganisationRole[],
  ): Promise<AdminContext> {
    const identity = await this.authenticate(headers);
    const organisationId = await this.organisationFor(
      `SELECT event.organisation_id::text AS organisation_id
       FROM payment_attempts attempt
       JOIN payments payment ON payment.id=attempt.payment_id
       JOIN events event ON event.id::text=payment.event_id
       WHERE attempt.id=$1`,
      [paymentAttemptId],
      'Payment attempt is unavailable to this operator',
    );
    return this.authorizeOrganisation(identity, organisationId, allowedRoles);
  }

  assertActor(authenticatedActorId: string, suppliedActorId: string, label = 'actorId'): void {
    if (authenticatedActorId !== suppliedActorId) {
      throw new ForbiddenException(`${label} must match the authenticated operator`);
    }
  }

  private async authorizeOrganisation(
    identity: OperatorIdentity,
    organisationId: string,
    allowedRoles: readonly OperatorOrganisationRole[],
  ): Promise<AdminContext> {
    if (!uuid(organisationId)) throw new UnauthorizedException('Organisation scope is invalid');
    if (identity.platformAdmin) {
      return { actorId: identity.actorId, organisationId, role: 'PLATFORM_ADMIN' };
    }
    await this.requireRole(identity, organisationId, allowedRoles);
    return { actorId: identity.actorId, organisationId, role: 'ADMIN' };
  }

  private async requireRole(
    identity: OperatorIdentity,
    organisationId: string,
    allowedRoles: readonly OperatorOrganisationRole[],
  ): Promise<OperatorOrganisationRole> {
    const role = await this.membership(identity.actorId, organisationId);
    if (!role || !allowedRoles.includes(role)) {
      throw new ForbiddenException('Operator role is not authorized for this organisation action');
    }
    return role;
  }

  private async membership(
    actorId: string,
    organisationId: string,
  ): Promise<OperatorOrganisationRole | undefined> {
    const rows = await this.database.query<MembershipRow>(
      `SELECT role
       FROM operator_memberships
       WHERE actor_id=$1 AND organisation_id=$2 AND status='ACTIVE'`,
      [actorId, organisationId],
    );
    return rows[0]?.role;
  }

  private selectedOrganisation(headers: HeadersRecord, required: boolean): string | undefined {
    const value = first(headers['x-organisation-id'])?.trim();
    if (!value) {
      if (required) throw new UnauthorizedException('x-organisation-id is required');
      return undefined;
    }
    if (!uuid(value)) throw new UnauthorizedException('x-organisation-id must be a UUID');
    return value;
  }

  private async organisationFor(
    query: string,
    values: unknown[],
    deniedMessage: string,
  ): Promise<string> {
    const rows = await this.database.query<OrganisationRow>(query, values);
    if (rows.length !== 1) throw new ForbiddenException(deniedMessage);
    return rows[0]!.organisation_id;
  }
}
