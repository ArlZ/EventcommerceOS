import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  AbuseProtectionService,
  type AbusePolicyName,
  type RateLimitDecision,
} from './abuse-protection.service';

type HeaderValue = string | string[] | undefined;
type HeadersRecord = Record<string, HeaderValue>;

export interface AbuseRequestLike {
  method?: string;
  path?: string;
  url?: string;
  ip?: string;
  socket?: { remoteAddress?: string };
  headers: HeadersRecord;
}

interface HttpResponse {
  setHeader(name: string, value: string): void;
}

export interface ClassifiedAbuseRequest {
  policy: AbusePolicyName;
  principalKey?: string;
  principalType: 'edge' | 'operator' | 'provider' | 'anonymous';
}

function first(value: HeaderValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function cookie(headers: HeadersRecord, name: string): string | undefined {
  const raw = first(headers.cookie);
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim() || undefined;
    }
  }
  return undefined;
}

function fingerprint(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizedPath(request: AbuseRequestLike): string {
  if (request.path) return request.path;
  const raw = request.url ?? '/';
  return raw.split('?', 1)[0] || '/';
}

function providerFromCallback(path: string): string | undefined {
  const match = /^\/payments\/providers\/([^/]+)\/callback$/.exec(path);
  return match?.[1]?.trim().toLowerCase();
}

function isEdgeSyncPath(path: string): boolean {
  return (
    path === '/sync/edge-events' ||
    path === '/inventory/edge-events' ||
    /^\/sync\/events\/[0-9a-f-]+\/(pos-menu-publications|pos-menu-install-receipts)$/i.test(path)
  );
}

function isEdgePaymentPath(path: string): boolean {
  return (
    path === '/payments/initiate' ||
    path === '/payments/providers/availability' ||
    /^\/payments\/attempts\/[^/]+\/reconcile$/.test(path) ||
    /^\/payments\/orders\/[^/]+$/.test(path)
  );
}

function isOperatorLoginPath(path: string): boolean {
  return (
    path === '/operator-auth/login/password' ||
    path === '/operator-auth/login/resend' ||
    path === '/operator-auth/login/verify'
  );
}

export function classifyAbuseRequest(
  request: AbuseRequestLike,
): ClassifiedAbuseRequest | undefined {
  const method = (request.method ?? 'GET').toUpperCase();
  if (method === 'OPTIONS') return undefined;

  const path = normalizedPath(request);
  const authorization = first(request.headers.authorization)?.trim() ?? '';
  const edgeId = first(request.headers['x-edge-id'])?.trim() ?? '';

  if (isOperatorLoginPath(path)) {
    const challenge = cookie(request.headers, 'ec_operator_login');
    return {
      policy: 'OPERATOR_LOGIN',
      ...(challenge ? { principalKey: fingerprint(`login:${challenge}`) } : {}),
      principalType: 'anonymous',
    };
  }

  if (isEdgeSyncPath(path)) {
    return {
      policy: 'EDGE_SYNC',
      principalKey: fingerprint(`edge:${edgeId}:${authorization}`),
      principalType: 'edge',
    };
  }

  if (isEdgePaymentPath(path)) {
    return {
      policy: 'EDGE_PAYMENT',
      principalKey: fingerprint(`edge:${edgeId}:${authorization}`),
      principalType: 'edge',
    };
  }

  const provider = providerFromCallback(path);
  if (provider) {
    return {
      policy: 'PROVIDER_CALLBACK',
      principalKey: fingerprint(`provider:${provider}`),
      principalType: 'provider',
    };
  }

  const sessionCookie = cookie(request.headers, 'ec_operator_session');
  const operatorCredential = authorization.startsWith('Bearer ecom_op_')
    ? authorization
    : sessionCookie?.startsWith('ecom_op_')
      ? `Cookie ${sessionCookie}`
      : '';
  if (operatorCredential) {
    return {
      policy: method === 'GET' || method === 'HEAD' ? 'OPERATOR_READ' : 'OPERATOR_MUTATION',
      principalKey: fingerprint(operatorCredential),
      principalType: 'operator',
    };
  }

  return { policy: 'PUBLIC', principalType: 'anonymous' };
}

@Injectable()
export class AbuseProtectionGuard implements CanActivate {
  private readonly logger = new Logger(AbuseProtectionGuard.name);
  private readonly lastWarningAt = new Map<string, number>();

  constructor(
    @Inject(AbuseProtectionService) private readonly protection: AbuseProtectionService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<AbuseRequestLike>();
    const response = context.switchToHttp().getResponse<HttpResponse>();
    const classified = classifyAbuseRequest(request);
    if (!classified) return true;

    const now = Date.now();
    const source = this.sourceKey(request);
    const sourceDecision = this.protection.consume(classified.policy, `source:${source}`, now);
    let principalDecision: RateLimitDecision | undefined;
    if (classified.principalKey) {
      principalDecision = this.protection.consume(
        classified.policy,
        `principal:${classified.principalKey}`,
        now,
      );
    }

    const decisions = principalDecision ? [sourceDecision, principalDecision] : [sourceDecision];
    const remaining = Math.min(...decisions.map((decision) => decision.remaining));
    const limit = Math.min(...decisions.map((decision) => decision.limit));
    const burst = Math.min(...decisions.map((decision) => decision.burst));
    response.setHeader('X-RateLimit-Policy', classified.policy);
    response.setHeader('X-RateLimit-Limit', String(limit));
    response.setHeader('X-RateLimit-Burst', String(burst));
    response.setHeader('X-RateLimit-Remaining', String(remaining));

    const rejected = decisions.find((decision) => !decision.allowed);
    if (!rejected) return true;

    const retryAfter = Math.max(...decisions.map((decision) => decision.retryAfterSeconds));
    response.setHeader('Retry-After', String(retryAfter));
    this.warnSampled(classified, source, retryAfter, now);
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        error: 'Too Many Requests',
        message: 'Request rate exceeded; retry later',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private sourceKey(request: AbuseRequestLike): string {
    const value = request.ip ?? request.socket?.remoteAddress ?? 'unknown';
    return fingerprint(value);
  }

  private warnSampled(
    classified: ClassifiedAbuseRequest,
    source: string,
    retryAfterSeconds: number,
    now: number,
  ): void {
    const warningKey = `${classified.policy}:${source}:${classified.principalKey ?? 'none'}`;
    const previous = this.lastWarningAt.get(warningKey) ?? 0;
    if (now - previous < 60_000) return;

    if (this.lastWarningAt.has(warningKey)) this.lastWarningAt.delete(warningKey);
    while (this.lastWarningAt.size >= 5_000) {
      const oldest = this.lastWarningAt.keys().next().value as string | undefined;
      if (!oldest) break;
      this.lastWarningAt.delete(oldest);
    }
    this.lastWarningAt.set(warningKey, now);
    this.logger.warn(
      JSON.stringify({
        event: 'HTTP_ABUSE_RATE_REJECT',
        policy: classified.policy,
        principalType: classified.principalType,
        sourceFingerprint: source.slice(0, 16),
        retryAfterSeconds,
      }),
    );
  }
}
