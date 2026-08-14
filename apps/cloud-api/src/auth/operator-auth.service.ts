import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';

export type OperatorRole = 'OPERATOR' | 'SUPERVISOR' | 'ADMIN' | 'PLATFORM_ADMIN';
export type PaymentOperatorPermission =
  | 'PAYMENT_MANUAL_CONFIRM'
  | 'PAYMENT_REFUND'
  | 'PAYMENT_VIEW';

export interface OperatorIdentity {
  actorId: string;
  organisationId: string | null;
  role: OperatorRole;
  credentialVersion: number;
  sessionVersion: number;
  tokenId: string;
  expiresAtEpochSeconds: number;
}

export interface OperatorSessionView {
  accessToken: string;
  tokenType: 'Bearer';
  expiresInSeconds: number;
  expiresAt: string;
  actorId: string;
  organisationId: string | null;
  role: OperatorRole;
}

interface OperatorRow extends QueryResultRow {
  actor_id: string;
  organisation_id: string | null;
  role: OperatorRole;
  credential_sha256: string;
  credential_version: number;
  session_version: number;
  status: 'ACTIVE' | 'REVOKED';
}

interface TokenHeader {
  alg: 'HS256';
  typ: 'JWT';
}

interface TokenClaims {
  iss: 'event-commerce-cloud';
  aud: 'operator';
  sub: string;
  org: string | null;
  role: OperatorRole;
  ver: number;
  sv: number;
  iat: number;
  exp: number;
  jti: string;
}

type HeadersRecord = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function jsonPart(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeJson(value: string): unknown {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
  } catch {
    throw new UnauthorizedException('Operator access token is malformed');
  }
}

function safeEqualText(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function isRole(value: unknown): value is OperatorRole {
  return (
    value === 'OPERATOR' ||
    value === 'SUPERVISOR' ||
    value === 'ADMIN' ||
    value === 'PLATFORM_ADMIN'
  );
}

function bearer(headers: HeadersRecord): string {
  const authorization = first(headers.authorization);
  if (!authorization?.startsWith('Bearer ')) {
    throw new UnauthorizedException('Operator bearer access token required');
  }
  const token = authorization.slice('Bearer '.length).trim();
  if (!token || token.length > 4096) {
    throw new UnauthorizedException('Operator bearer access token is invalid');
  }
  return token;
}

@Injectable()
export class OperatorAuthService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  async createSession(actorId: string, credential: string): Promise<OperatorSessionView> {
    const normalizedActorId = actorId.trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizedActorId)) {
      throw new BadRequestException('actorId must be a UUID');
    }
    if (credential.length < 32 || credential.length > 512) {
      throw new UnauthorizedException('Operator credential is invalid');
    }

    const rows = await this.db.query<OperatorRow>(
      `SELECT actor_id::text,organisation_id::text,role,credential_sha256,
              credential_version,session_version,status
       FROM operator_accounts WHERE actor_id=$1`,
      [normalizedActorId],
    );
    const row = rows[0];
    if (!row || row.status !== 'ACTIVE') {
      throw new UnauthorizedException('Operator credential is not active');
    }
    const actual = sha256(credential);
    const expected = Buffer.from(row.credential_sha256, 'hex');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new UnauthorizedException('Operator credential is invalid');
    }

    const touched = await this.db.query<{ actor_id: string }>(
      `UPDATE operator_accounts SET last_authenticated_at=now()
       WHERE actor_id=$1 AND credential_version=$2 AND session_version=$3 AND status='ACTIVE'
       RETURNING actor_id::text`,
      [row.actor_id, row.credential_version, row.session_version],
    );
    if (touched.length !== 1) {
      throw new UnauthorizedException('Operator credential changed during authentication');
    }

    const ttl = this.ttlSeconds();
    const now = Math.floor(Date.now() / 1000);
    const claims: TokenClaims = {
      iss: 'event-commerce-cloud',
      aud: 'operator',
      sub: row.actor_id,
      org: row.organisation_id,
      role: row.role,
      ver: row.credential_version,
      sv: row.session_version,
      iat: now,
      exp: now + ttl,
      jti: randomUUID(),
    };
    return {
      accessToken: this.sign(claims),
      tokenType: 'Bearer',
      expiresInSeconds: ttl,
      expiresAt: new Date(claims.exp * 1000).toISOString(),
      actorId: claims.sub,
      organisationId: claims.org,
      role: claims.role,
    };
  }

  async authenticateHeaders(headers: HeadersRecord): Promise<OperatorIdentity> {
    return this.authenticateToken(bearer(headers));
  }

  async authenticateToken(token: string): Promise<OperatorIdentity> {
    const parts = token.split('.');
    if (parts.length !== 3) throw new UnauthorizedException('Operator access token is malformed');
    const [encodedHeader, encodedClaims, signature] = parts as [string, string, string];
    const expectedSignature = this.signature(`${encodedHeader}.${encodedClaims}`);
    if (!safeEqualText(signature, expectedSignature)) {
      throw new UnauthorizedException('Operator access token signature is invalid');
    }

    const header = decodeJson(encodedHeader);
    const claims = decodeJson(encodedClaims);
    if (!header || typeof header !== 'object' || Array.isArray(header)) {
      throw new UnauthorizedException('Operator access token header is invalid');
    }
    const headerRecord = header as Record<string, unknown>;
    if (headerRecord.alg !== 'HS256' || headerRecord.typ !== 'JWT') {
      throw new UnauthorizedException('Operator access token algorithm is invalid');
    }
    const parsed = this.parseClaims(claims);
    const now = Math.floor(Date.now() / 1000);
    if (parsed.exp <= now || parsed.iat > now + 30 || parsed.exp - parsed.iat > 3600) {
      throw new UnauthorizedException('Operator access token is expired or has invalid lifetime');
    }

    const rows = await this.db.query<OperatorRow>(
      `SELECT actor_id::text,organisation_id::text,role,credential_sha256,
              credential_version,session_version,status
       FROM operator_accounts WHERE actor_id=$1`,
      [parsed.sub],
    );
    const row = rows[0];
    if (
      !row ||
      row.status !== 'ACTIVE' ||
      row.credential_version !== parsed.ver ||
      row.session_version !== parsed.sv ||
      row.role !== parsed.role ||
      row.organisation_id !== parsed.org
    ) {
      throw new UnauthorizedException('Operator access token is no longer valid');
    }

    return {
      actorId: parsed.sub,
      organisationId: parsed.org,
      role: parsed.role,
      credentialVersion: parsed.ver,
      sessionVersion: parsed.sv,
      tokenId: parsed.jti,
      expiresAtEpochSeconds: parsed.exp,
    };
  }

  requireRole(identity: OperatorIdentity, allowed: readonly OperatorRole[]): void {
    if (!allowed.includes(identity.role)) {
      throw new ForbiddenException('Operator role is not authorized for this action');
    }
  }

  assertOrganisationAccess(identity: OperatorIdentity, organisationId: string): void {
    if (identity.role === 'PLATFORM_ADMIN') return;
    if (identity.organisationId !== organisationId) {
      throw new ForbiddenException('Cross-organisation operator access is not allowed');
    }
  }

  async assertEventAccess(identity: OperatorIdentity, eventId: string): Promise<void> {
    const rows = await this.db.query<{ organisation_id: string }>(
      'SELECT organisation_id::text FROM events WHERE id=$1',
      [eventId],
    );
    const organisationId = rows[0]?.organisation_id;
    if (!organisationId) throw new BadRequestException('Event not found');
    this.assertOrganisationAccess(identity, organisationId);
  }

  async assertPaymentPermission(
    identity: OperatorIdentity,
    eventId: string,
    permission: PaymentOperatorPermission,
  ): Promise<void> {
    await this.assertEventAccess(identity, eventId);
    if (identity.role === 'ADMIN' || identity.role === 'PLATFORM_ADMIN') return;
    if (identity.role !== 'SUPERVISOR') {
      throw new ForbiddenException('Supervisor role is required for this payment action');
    }
    const rows = await this.db.query(
      `SELECT 1 FROM payment_actor_permissions
       WHERE event_id=$1 AND actor_id=$2 AND permission=$3`,
      [eventId, identity.actorId, permission],
    );
    if (rows.length !== 1) {
      throw new ForbiddenException(`Operator lacks ${permission}`);
    }
  }

  async revokeOwnSessions(identity: OperatorIdentity): Promise<{ sessionVersion: number }> {
    return this.db.transaction(async (client) => {
      const updated = await client.query<{ session_version: number; role: OperatorRole; organisation_id: string | null; credential_version: number }>(
        `UPDATE operator_accounts
         SET session_version=session_version+1,updated_at=now()
         WHERE actor_id=$1 AND session_version=$2 AND status='ACTIVE'
         RETURNING session_version,role,organisation_id::text,credential_version`,
        [identity.actorId, identity.sessionVersion],
      );
      const row = updated.rows[0];
      if (!row) throw new UnauthorizedException('Operator session is no longer active');
      await client.query(
        `INSERT INTO operator_account_audit(
           actor_id,organisation_id,action,role,credential_version,session_version,performed_by
         ) VALUES ($1,$2,'SESSIONS_REVOKED',$3,$4,$5,$6)`,
        [
          identity.actorId,
          row.organisation_id,
          row.role,
          row.credential_version,
          row.session_version,
          identity.actorId,
        ],
      );
      return { sessionVersion: row.session_version };
    });
  }

  private sign(claims: TokenClaims): string {
    const header: TokenHeader = { alg: 'HS256', typ: 'JWT' };
    const encodedHeader = jsonPart(header);
    const encodedClaims = jsonPart(claims);
    const body = `${encodedHeader}.${encodedClaims}`;
    return `${body}.${this.signature(body)}`;
  }

  private signature(body: string): string {
    return createHmac('sha256', this.signingKey()).update(body, 'utf8').digest('base64url');
  }

  private signingKey(): Buffer {
    const encoded = process.env.OPERATOR_TOKEN_SIGNING_KEY?.trim();
    if (!encoded || !/^[A-Za-z0-9_-]{43,}$/.test(encoded)) {
      throw new Error('OPERATOR_TOKEN_SIGNING_KEY must be base64url encoded with at least 256 bits');
    }
    const key = Buffer.from(encoded, 'base64url');
    if (key.length < 32) {
      throw new Error('OPERATOR_TOKEN_SIGNING_KEY must contain at least 256 bits');
    }
    return key;
  }

  private ttlSeconds(): number {
    const value = Number(process.env.OPERATOR_ACCESS_TOKEN_TTL_SECONDS ?? '900');
    if (!Number.isSafeInteger(value) || value < 60 || value > 3600) {
      throw new Error('OPERATOR_ACCESS_TOKEN_TTL_SECONDS must be between 60 and 3600');
    }
    return value;
  }

  private parseClaims(value: unknown): TokenClaims {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new UnauthorizedException('Operator access token claims are invalid');
    }
    const record = value as Record<string, unknown>;
    if (
      record.iss !== 'event-commerce-cloud' ||
      record.aud !== 'operator' ||
      typeof record.sub !== 'string' ||
      !isRole(record.role) ||
      (record.org !== null && typeof record.org !== 'string') ||
      !Number.isSafeInteger(record.ver) ||
      !Number.isSafeInteger(record.sv) ||
      !Number.isSafeInteger(record.iat) ||
      !Number.isSafeInteger(record.exp) ||
      typeof record.jti !== 'string' ||
      !record.jti
    ) {
      throw new UnauthorizedException('Operator access token claims are invalid');
    }
    return {
      iss: 'event-commerce-cloud',
      aud: 'operator',
      sub: record.sub,
      org: record.org as string | null,
      role: record.role,
      ver: record.ver as number,
      sv: record.sv as number,
      iat: record.iat as number,
      exp: record.exp as number,
      jti: record.jti,
    };
  }
}
