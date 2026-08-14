import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import type { AdminContext } from '../configuration/admin-context';
import { DatabaseService } from '../database/database.service';

type HeadersRecord = Record<string, string | string[] | undefined>;

interface UserCredentialRow extends QueryResultRow {
  id: string;
  email: string;
  password_salt: Buffer;
  password_hash: Buffer;
  status: 'ACTIVE' | 'DISABLED';
  platform_role: 'PLATFORM_ADMIN' | null;
  auth_version: number;
}

interface MembershipRow extends QueryResultRow {
  role: 'ADMIN';
  status: 'ACTIVE' | 'REVOKED';
}

interface SessionRow extends QueryResultRow {
  session_id: string;
  user_id: string;
  organisation_id: string | null;
  role: 'ADMIN' | 'PLATFORM_ADMIN';
  user_auth_version: number;
  user_status: 'ACTIVE' | 'DISABLED';
  current_auth_version: number;
  membership_status: 'ACTIVE' | 'REVOKED' | null;
}

export interface HumanSessionView {
  accessToken: string;
  expiresAt: string;
  actorId: string;
  role: 'ADMIN' | 'PLATFORM_ADMIN';
  organisationId: string | null;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function bearer(headers: HeadersRecord): string {
  const authorization = first(headers.authorization);
  if (!authorization?.startsWith('Bearer ')) {
    throw new UnauthorizedException('Human bearer session required');
  }
  const token = authorization.slice('Bearer '.length).trim();
  if (token.length < 32 || token.length > 512) {
    throw new UnauthorizedException('Human session token is invalid');
  }
  return token;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function derivePassword(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key as Buffer);
    });
  });
}

function sessionTtlSeconds(): number {
  const value = Number(process.env.HUMAN_SESSION_TTL_SECONDS ?? '28800');
  if (!Number.isSafeInteger(value) || value < 300 || value > 43200) {
    throw new Error('HUMAN_SESSION_TTL_SECONDS must be an integer between 300 and 43200');
  }
  return value;
}

@Injectable()
export class HumanAuthService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async login(emailValue: string, password: string, organisationId?: string): Promise<HumanSessionView> {
    const email = emailValue.trim().toLowerCase();
    if (!email || !password) throw new UnauthorizedException('Invalid email or password');
    const users = await this.database.query<UserCredentialRow>(
      `SELECT id::text,email,password_salt,password_hash,status,platform_role,auth_version
       FROM human_users WHERE email=$1`,
      [email],
    );
    const user = users[0];
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Invalid email or password');
    }
    const derived = await derivePassword(password, user.password_salt);
    if (
      derived.length !== user.password_hash.length ||
      !timingSafeEqual(derived, user.password_hash)
    ) {
      throw new UnauthorizedException('Invalid email or password');
    }

    let role: HumanSessionView['role'];
    let resolvedOrganisation: string | null = organisationId?.trim() || null;
    if (user.platform_role === 'PLATFORM_ADMIN') {
      role = 'PLATFORM_ADMIN';
      if (resolvedOrganisation) {
        const org = await this.database.query<{ id: string }>(
          'SELECT id::text FROM organisations WHERE id=$1 AND lifecycle <> \'ARCHIVED\'',
          [resolvedOrganisation],
        );
        if (org.length !== 1) throw new ForbiddenException('Organisation is not available');
      }
    } else {
      if (!resolvedOrganisation) {
        throw new ForbiddenException('organisationId is required for organisation users');
      }
      const memberships = await this.database.query<MembershipRow>(
        `SELECT role,status FROM human_organisation_memberships
         WHERE user_id=$1 AND organisation_id=$2`,
        [user.id, resolvedOrganisation],
      );
      const membership = memberships[0];
      if (!membership || membership.status !== 'ACTIVE') {
        throw new ForbiddenException('Active organisation membership required');
      }
      role = membership.role;
    }

    const token = randomBytes(32).toString('base64url');
    const sessionId = randomUUID();
    const ttl = sessionTtlSeconds();
    const rows = await this.database.query<{ expires_at: Date }>(
      `INSERT INTO human_sessions(
         id,user_id,organisation_id,role,token_sha256,user_auth_version,expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6,now()+($7 * interval '1 second'))
       RETURNING expires_at`,
      [sessionId, user.id, resolvedOrganisation, role, sha256(token), user.auth_version, ttl],
    );
    await this.database.query(
      `INSERT INTO human_auth_audit(user_id,organisation_id,action,actor_id,details)
       VALUES ($1,$2,'SESSION_ISSUED',$1,$3::jsonb)`,
      [user.id, resolvedOrganisation, JSON.stringify({ sessionId, role })],
    );
    return {
      accessToken: token,
      expiresAt: rows[0]!.expires_at.toISOString(),
      actorId: user.id,
      role,
      organisationId: resolvedOrganisation,
    };
  }

  async authenticate(headers: HeadersRecord): Promise<AdminContext> {
    const token = bearer(headers);
    const rows = await this.database.query<SessionRow>(
      `SELECT s.id::text AS session_id,s.user_id::text,s.organisation_id::text,s.role,
              s.user_auth_version,u.status AS user_status,u.auth_version AS current_auth_version,
              m.status AS membership_status
       FROM human_sessions s
       JOIN human_users u ON u.id=s.user_id
       LEFT JOIN human_organisation_memberships m
         ON m.user_id=s.user_id AND m.organisation_id=s.organisation_id
       WHERE s.token_sha256=$1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
      [sha256(token)],
    );
    const row = rows[0];
    if (!row || row.user_status !== 'ACTIVE' || row.user_auth_version !== row.current_auth_version) {
      throw new UnauthorizedException('Human session is expired or revoked');
    }
    if (row.role === 'ADMIN' && row.membership_status !== 'ACTIVE') {
      throw new UnauthorizedException('Organisation membership is no longer active');
    }
    const touched = await this.database.query<{ id: string }>(
      `UPDATE human_sessions SET last_seen_at=now()
       WHERE id=$1 AND revoked_at IS NULL AND expires_at > now()
       RETURNING id::text`,
      [row.session_id],
    );
    if (touched.length !== 1) throw new UnauthorizedException('Human session is no longer active');
    return {
      actorId: row.user_id,
      role: row.role,
      ...(row.organisation_id ? { organisationId: row.organisation_id } : {}),
    };
  }

  async adminContext(headers: HeadersRecord, organisationRequired = true): Promise<AdminContext> {
    const context = await this.authenticate(headers);
    if (organisationRequired && context.role !== 'PLATFORM_ADMIN' && !context.organisationId) {
      throw new ForbiddenException('Organisation-scoped session required');
    }
    return context;
  }

  async logout(headers: HeadersRecord): Promise<{ revoked: true }> {
    const token = bearer(headers);
    const rows = await this.database.query<{ id: string; user_id: string; organisation_id: string | null }>(
      `UPDATE human_sessions SET revoked_at=now()
       WHERE token_sha256=$1 AND revoked_at IS NULL
       RETURNING id::text,user_id::text,organisation_id::text`,
      [sha256(token)],
    );
    const row = rows[0];
    if (!row) throw new UnauthorizedException('Human session is already expired or revoked');
    await this.database.query(
      `INSERT INTO human_auth_audit(user_id,organisation_id,action,actor_id,details)
       VALUES ($1,$2,'SESSION_REVOKED',$1,$3::jsonb)`,
      [row.user_id, row.organisation_id, JSON.stringify({ sessionId: row.id })],
    );
    return { revoked: true };
  }

  static async passwordDigest(password: string): Promise<{ salt: Buffer; hash: Buffer }> {
    if (password.length < 14 || password.length > 256) {
      throw new Error('password must be between 14 and 256 characters');
    }
    const salt = randomBytes(16);
    return { salt, hash: await derivePassword(password, salt) };
  }
}
