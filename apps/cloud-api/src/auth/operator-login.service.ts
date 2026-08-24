import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';
import { SupabaseAuthTransport, type SupabaseAuthProof } from './supabase-auth.transport';

interface OperatorRow {
  id: string;
  email: string | null;
  supabase_user_id: string | null;
}

interface ChallengeRow {
  id: string;
  actor_id: string;
  supabase_user_id: string;
  email: string;
  remember_device: boolean;
}

interface ProfileRow extends QueryResultRow {
  display_name: string;
  email: string | null;
  platform_role: 'PLATFORM_ADMIN' | null;
}

export interface OperatorLoginProfile {
  actorId: string;
  displayName: string;
  email: string | null;
  platformAdmin: boolean;
}

export interface BeginOperatorLoginResult {
  challengeToken: string;
  maskedEmail: string;
  resendAfterSeconds: number;
}

export interface CompleteOperatorLoginResult {
  sessionToken: string;
  rememberDevice: boolean;
  profile: OperatorLoginProfile;
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequestException('Request body must be an object');
  }
  return value as Record<string, unknown>;
}

export function loginEmail(value: unknown): string {
  if (typeof value !== 'string') throw new BadRequestException('Email is required');
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 320 || !email.includes('@')) {
    throw new BadRequestException('Email is invalid');
  }
  return email;
}

function loginPassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 1_024) {
    throw new BadRequestException('Password is required');
  }
  return value;
}

function rememberDevice(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw new BadRequestException('rememberDevice must be boolean');
  return value;
}

function verificationCode(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{6}$/.test(value.trim())) {
    throw new BadRequestException('Verification code must contain six digits');
  }
  return value.trim();
}

export function maskOperatorEmail(email: string): string {
  const separator = email.lastIndexOf('@');
  if (separator <= 0) return '•••';
  return `${email.slice(0, 1)}•••${email.slice(separator)}`;
}

function authFailure(error: unknown, message: string): never {
  if (error instanceof HttpException) {
    const status = error.getStatus();
    if (status === 429 || status >= 500) throw error;
  }
  throw new UnauthorizedException(message);
}

@Injectable()
export class OperatorLoginService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(SupabaseAuthTransport) private readonly supabase: SupabaseAuthTransport,
  ) {}

  async begin(body: unknown): Promise<BeginOperatorLoginResult> {
    const input = record(body);
    const email = loginEmail(input.email);
    const password = loginPassword(input.password);
    const remember = rememberDevice(input.rememberDevice);

    let proof: SupabaseAuthProof;
    try {
      proof = await this.supabase.passwordSignIn(email, password);
    } catch (error) {
      authFailure(error, 'Incorrect email or password');
    }

    try {
      if (proof.email !== email) throw new UnauthorizedException('Incorrect email or password');
      const identities = await this.database.query<OperatorRow>(
        `SELECT id::text,email,supabase_user_id::text
         FROM operator_identities
         WHERE lower(email)=lower($1) AND status='ACTIVE'`,
        [email],
      );
      const identity = identities.length === 1 ? identities[0] : undefined;
      if (
        !identity ||
        !identity.email ||
        (identity.supabase_user_id !== null && identity.supabase_user_id !== proof.userId)
      ) {
        throw new UnauthorizedException('Incorrect email or password');
      }

      const challengeToken = `ecom_login_${randomBytes(32).toString('base64url')}`;
      const challengeId = randomUUID();
      await this.database.query(
        `INSERT INTO operator_login_challenges(
           id,actor_id,supabase_user_id,email,challenge_sha256,remember_device,expires_at
         ) VALUES ($1,$2,$3,$4,$5,$6,now()+interval '10 minutes')`,
        [challengeId, identity.id, proof.userId, email, digest(challengeToken), remember],
      );

      try {
        await this.supabase.sendEmailOtp(email);
      } catch (error) {
        await this.database.query(
          `UPDATE operator_login_challenges SET completed_at=now()
           WHERE id=$1 AND completed_at IS NULL`,
          [challengeId],
        );
        authFailure(error, 'Unable to send verification code');
      }

      return {
        challengeToken,
        maskedEmail: maskOperatorEmail(email),
        resendAfterSeconds: 60,
      };
    } finally {
      await this.supabase.signOut(proof.accessToken);
    }
  }

  async resend(challengeToken: string | undefined): Promise<{ resendAfterSeconds: number }> {
    const token = this.challengeToken(challengeToken);
    const rows = await this.database.query<ChallengeRow>(
      `UPDATE operator_login_challenges
       SET last_sent_at=now()
       WHERE challenge_sha256=$1
         AND completed_at IS NULL
         AND expires_at > now()
         AND last_sent_at <= now()-interval '60 seconds'
       RETURNING id::text,actor_id::text,supabase_user_id::text,email,remember_device`,
      [digest(token)],
    );
    const challenge = rows[0];
    if (!challenge) {
      throw new UnauthorizedException(
        'Verification code cannot be resent yet or the sign-in expired',
      );
    }
    try {
      await this.supabase.sendEmailOtp(challenge.email);
    } catch (error) {
      authFailure(error, 'Unable to resend verification code');
    }
    return { resendAfterSeconds: 60 };
  }

  async complete(
    challengeToken: string | undefined,
    body: unknown,
  ): Promise<CompleteOperatorLoginResult> {
    const token = this.challengeToken(challengeToken);
    const code = verificationCode(record(body).code);
    const rows = await this.database.query<ChallengeRow>(
      `SELECT id::text,actor_id::text,supabase_user_id::text,email,remember_device
       FROM operator_login_challenges
       WHERE challenge_sha256=$1 AND completed_at IS NULL AND expires_at > now()`,
      [digest(token)],
    );
    const challenge = rows[0];
    if (!challenge) throw new UnauthorizedException('Sign-in verification has expired');

    let proof: SupabaseAuthProof;
    try {
      proof = await this.supabase.verifyEmailOtp(challenge.email, code);
    } catch (error) {
      authFailure(error, 'Incorrect verification code');
    }

    try {
      if (proof.userId !== challenge.supabase_user_id || proof.email !== challenge.email) {
        throw new UnauthorizedException('Verification identity does not match sign-in challenge');
      }
      const issued = await this.database.transaction(async (client) =>
        this.issueSession(client, challenge, proof.userId),
      );
      return {
        sessionToken: issued.sessionToken,
        rememberDevice: challenge.remember_device,
        profile: issued.profile,
      };
    } finally {
      await this.supabase.signOut(proof.accessToken);
    }
  }

  async profile(actorId: string): Promise<OperatorLoginProfile> {
    const rows = await this.database.query<ProfileRow>(
      `SELECT display_name,email,platform_role FROM operator_identities
       WHERE id=$1 AND status='ACTIVE'`,
      [actorId],
    );
    const row = rows[0];
    if (!row) throw new UnauthorizedException('Operator identity is unavailable');
    return {
      actorId,
      displayName: row.display_name,
      email: row.email,
      platformAdmin: row.platform_role === 'PLATFORM_ADMIN',
    };
  }

  private async issueSession(
    client: PoolClient,
    challenge: ChallengeRow,
    supabaseUserId: string,
  ): Promise<{ sessionToken: string; profile: OperatorLoginProfile }> {
    const consumed = await client.query(
      `UPDATE operator_login_challenges SET completed_at=now()
       WHERE id=$1 AND completed_at IS NULL AND expires_at > now()
       RETURNING id`,
      [challenge.id],
    );
    if (consumed.rowCount !== 1)
      throw new UnauthorizedException('Sign-in verification has expired');

    const identities = await client.query<ProfileRow>(
      `UPDATE operator_identities
       SET supabase_user_id=coalesce(supabase_user_id,$2),updated_at=now()
       WHERE id=$1
         AND status='ACTIVE'
         AND lower(email)=lower($3)
         AND (supabase_user_id IS NULL OR supabase_user_id=$2)
       RETURNING display_name,email,platform_role`,
      [challenge.actor_id, supabaseUserId, challenge.email],
    );
    const identity = identities.rows[0];
    if (!identity) throw new UnauthorizedException('Operator identity is unavailable');

    const sessionId = randomUUID();
    const sessionToken = `ecom_op_${randomBytes(32).toString('base64url')}`;
    const ttlMinutes = challenge.remember_device ? 30 * 24 * 60 : 12 * 60;
    await client.query(
      `INSERT INTO operator_sessions(id,actor_id,token_sha256,expires_at)
       VALUES ($1,$2,$3,now()+($4::text || ' minutes')::interval)`,
      [sessionId, challenge.actor_id, digest(sessionToken), ttlMinutes],
    );
    await client.query(
      `INSERT INTO operator_auth_audit(
         actor_id,action,target_actor_id,session_id,performed_by,details
       ) VALUES ($1,'SESSION_CREATED',$1,$2,'operator-login',$3::jsonb)`,
      [
        challenge.actor_id,
        sessionId,
        JSON.stringify({
          ttlMinutes,
          emailVerification: true,
          rememberDevice: challenge.remember_device,
        }),
      ],
    );

    return {
      sessionToken,
      profile: {
        actorId: challenge.actor_id,
        displayName: identity.display_name,
        email: identity.email,
        platformAdmin: identity.platform_role === 'PLATFORM_ADMIN',
      },
    };
  }

  private challengeToken(value: string | undefined): string {
    if (!value || !value.startsWith('ecom_login_') || value.length < 48 || value.length > 256) {
      throw new UnauthorizedException('Sign-in verification has expired');
    }
    return value;
  }
}
