import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createPublicKey, verify as verifyBytes, type KeyObject } from 'node:crypto';
import { EdgeDatabaseService } from '../database/database.service';

export type EdgeOperatorRole = 'OPERATOR' | 'SUPERVISOR' | 'ADMIN' | 'PLATFORM_ADMIN';

export interface EdgeOperatorIdentity {
  actorId: string;
  organisationId: string | null;
  role: EdgeOperatorRole;
  credentialVersion: number;
  sessionVersion: number;
  tokenId: string;
  expiresAtEpochSeconds: number;
}

interface OperatorTokenClaims {
  iss: 'event-commerce-cloud';
  aud: 'operator';
  sub: string;
  org: string | null;
  role: EdgeOperatorRole;
  ver: number;
  sv: number;
  iat: number;
  exp: number;
  jti: string;
}

type HeadersRecord = Record<string, string | string[] | undefined>;
const MAX_OPERATOR_TOKEN_LIFETIME_SECONDS = 43_200;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
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

function decodeJson(value: string): unknown {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
  } catch {
    throw new UnauthorizedException('Operator access token is malformed');
  }
}

function isRole(value: unknown): value is EdgeOperatorRole {
  return (
    value === 'OPERATOR' ||
    value === 'SUPERVISOR' ||
    value === 'ADMIN' ||
    value === 'PLATFORM_ADMIN'
  );
}

@Injectable()
export class OperatorEdgeAuthService {
  constructor(@Inject(EdgeDatabaseService) private readonly db: EdgeDatabaseService) {}

  authenticateHeaders(headers: HeadersRecord): EdgeOperatorIdentity {
    const claims = this.verifyToken(bearer(headers));
    const edgeOrganisationId = process.env.EDGE_ORGANISATION_ID?.trim();
    if (!edgeOrganisationId) {
      throw new Error('EDGE_ORGANISATION_ID is required for operator authorization');
    }
    if (claims.role !== 'PLATFORM_ADMIN' && claims.org !== edgeOrganisationId) {
      throw new ForbiddenException('Operator is outside the Event Edge organisation');
    }
    return {
      actorId: claims.sub,
      organisationId: claims.org,
      role: claims.role,
      credentialVersion: claims.ver,
      sessionVersion: claims.sv,
      tokenId: claims.jti,
      expiresAtEpochSeconds: claims.exp,
    };
  }

  requireRole(identity: EdgeOperatorIdentity, allowed: readonly EdgeOperatorRole[]): void {
    if (!allowed.includes(identity.role)) {
      throw new ForbiddenException('Operator role is not authorized for this Edge action');
    }
  }

  assertActor(identity: EdgeOperatorIdentity, actorId: string): void {
    if (actorId !== identity.actorId) {
      throw new ForbiddenException('Request actorId must match authenticated operator');
    }
  }

  async assertEventInstalled(eventId: string): Promise<void> {
    const rows = await this.db.query(
      'SELECT 1 FROM edge_inventory_event_config WHERE event_id=$1',
      [eventId],
    );
    if (rows.length !== 1) {
      throw new ForbiddenException('Event is not installed on this Event Edge');
    }
  }

  private verifyToken(token: string): OperatorTokenClaims {
    const parts = token.split('.');
    if (parts.length !== 3) throw new UnauthorizedException('Operator access token is malformed');
    const [encodedHeader, encodedClaims, encodedSignature] = parts as [string, string, string];
    const header = decodeJson(encodedHeader);
    if (!header || typeof header !== 'object' || Array.isArray(header)) {
      throw new UnauthorizedException('Operator access token header is invalid');
    }
    const headerRecord = header as Record<string, unknown>;
    if (headerRecord.alg !== 'EdDSA' || headerRecord.typ !== 'JWT') {
      throw new UnauthorizedException('Operator access token algorithm is invalid');
    }

    let verified = false;
    try {
      verified = verifyBytes(
        null,
        Buffer.from(`${encodedHeader}.${encodedClaims}`, 'utf8'),
        this.publicKey(),
        Buffer.from(encodedSignature, 'base64url'),
      );
    } catch {
      verified = false;
    }
    if (!verified) throw new UnauthorizedException('Operator access token signature is invalid');

    const claims = this.parseClaims(decodeJson(encodedClaims));
    const now = Math.floor(Date.now() / 1000);
    if (
      claims.exp <= now ||
      claims.iat > now + 30 ||
      claims.exp - claims.iat > MAX_OPERATOR_TOKEN_LIFETIME_SECONDS
    ) {
      throw new UnauthorizedException('Operator access token is expired or has invalid lifetime');
    }
    return claims;
  }

  private publicKey(): KeyObject {
    const encoded = process.env.OPERATOR_TOKEN_VERIFYING_PUBLIC_KEY?.trim();
    if (!encoded) throw new Error('OPERATOR_TOKEN_VERIFYING_PUBLIC_KEY is required');
    try {
      return createPublicKey({
        key: Buffer.from(encoded, 'base64url'),
        format: 'der',
        type: 'spki',
      });
    } catch {
      throw new Error('OPERATOR_TOKEN_VERIFYING_PUBLIC_KEY must be a base64url Ed25519 SPKI key');
    }
  }

  private parseClaims(value: unknown): OperatorTokenClaims {
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
