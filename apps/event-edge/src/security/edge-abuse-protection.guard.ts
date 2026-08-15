import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { createHash } from 'node:crypto';

type Policy = 'DEVICE_SYNC' | 'DEVICE_PAYMENT' | 'LOCAL_OTHER';
type HeaderValue = string | string[] | undefined;

interface RequestLike {
  method?: string;
  path?: string;
  url?: string;
  ip?: string;
  socket?: { remoteAddress?: string };
  headers: Record<string, HeaderValue>;
}

interface ResponseLike {
  setHeader(name: string, value: string): void;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

interface Classification {
  policy: Policy;
  principal?: string;
}

const DEFAULT_LIMITS: Record<Policy, number> = {
  DEVICE_SYNC: 1_800,
  DEVICE_PAYMENT: 1_200,
  LOCAL_OTHER: 300,
};

function bounded(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function first(value: HeaderValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function pathOf(request: RequestLike): string {
  if (request.path) return request.path;
  return (request.url ?? '/').split('?', 1)[0] || '/';
}

function isDevicePayment(path: string): boolean {
  return (
    path === '/payments/initiate' ||
    path === '/payments/providers/availability' ||
    /^\/payments\/attempts\/[^/]+\/reconcile$/.test(path) ||
    /^\/payments\/orders\/[^/]+$/.test(path)
  );
}

export function classifyEdgeAbuseRequest(request: RequestLike): Classification | undefined {
  if ((request.method ?? 'GET').toUpperCase() === 'OPTIONS') return undefined;
  const path = pathOf(request);
  const authorization = first(request.headers.authorization)?.trim() ?? '';
  const deviceId = first(request.headers['x-device-id'])?.trim() ?? '';
  const principal = deviceId || authorization ? hash(`device:${deviceId}:${authorization}`) : undefined;

  if (path === '/sync/device-events') return { policy: 'DEVICE_SYNC', principal };
  if (isDevicePayment(path)) return { policy: 'DEVICE_PAYMENT', principal };
  return { policy: 'LOCAL_OTHER', principal };
}

@Injectable()
export class EdgeAbuseProtectionGuard implements CanActivate {
  private readonly logger = new Logger(EdgeAbuseProtectionGuard.name);
  private readonly buckets = new Map<string, Bucket>();
  private readonly warnedAt = new Map<string, number>();
  private readonly maxBuckets = bounded('EDGE_ABUSE_MAX_BUCKETS', 10_000, 500, 50_000);
  private readonly limits: Record<Policy, number> = {
    DEVICE_SYNC: bounded(
      'EDGE_ABUSE_LIMIT_DEVICE_SYNC_PER_MINUTE',
      DEFAULT_LIMITS.DEVICE_SYNC,
      60,
      100_000,
    ),
    DEVICE_PAYMENT: bounded(
      'EDGE_ABUSE_LIMIT_DEVICE_PAYMENT_PER_MINUTE',
      DEFAULT_LIMITS.DEVICE_PAYMENT,
      60,
      100_000,
    ),
    LOCAL_OTHER: bounded(
      'EDGE_ABUSE_LIMIT_LOCAL_OTHER_PER_MINUTE',
      DEFAULT_LIMITS.LOCAL_OTHER,
      30,
      10_000,
    ),
  };

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<RequestLike>();
    const response = context.switchToHttp().getResponse<ResponseLike>();
    const classification = classifyEdgeAbuseRequest(request);
    if (!classification) return true;

    const now = Date.now();
    const source = hash(request.ip ?? request.socket?.remoteAddress ?? 'unknown');
    const decisions = [this.consume(classification.policy, `source:${source}`, now)];
    if (classification.principal) {
      decisions.push(this.consume(classification.policy, `principal:${classification.principal}`, now));
    }

    const remaining = Math.min(...decisions.map((item) => item.remaining));
    response.setHeader('X-RateLimit-Policy', classification.policy);
    response.setHeader('X-RateLimit-Limit', String(this.limits[classification.policy]));
    response.setHeader('X-RateLimit-Remaining', String(remaining));

    const rejected = decisions.find((item) => !item.allowed);
    if (!rejected) return true;
    const retryAfter = Math.max(...decisions.map((item) => item.retryAfter));
    response.setHeader('Retry-After', String(retryAfter));
    this.warn(classification.policy, source, retryAfter, now);
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        error: 'Too Many Requests',
        message: 'Event Edge request rate exceeded; retry later',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  limit(policy: Policy): number {
    return this.limits[policy];
  }

  private consume(
    policy: Policy,
    key: string,
    now: number,
  ): { allowed: boolean; remaining: number; retryAfter: number } {
    const limit = this.limits[policy];
    const refillPerMs = limit / 60_000;
    const bucketKey = `${policy}:${key}`;
    const existing = this.buckets.get(bucketKey);
    const elapsed = existing ? Math.max(0, now - existing.updatedAt) : 0;
    const available = existing
      ? Math.min(limit, existing.tokens + elapsed * refillPerMs)
      : limit;

    if (available < 1) {
      this.touch(bucketKey, { tokens: available, updatedAt: now });
      return {
        allowed: false,
        remaining: 0,
        retryAfter: Math.max(1, Math.ceil((1 - available) / refillPerMs / 1000)),
      };
    }

    const remaining = available - 1;
    this.touch(bucketKey, { tokens: remaining, updatedAt: now });
    return { allowed: true, remaining: Math.max(0, Math.floor(remaining)), retryAfter: 0 };
  }

  private touch(key: string, bucket: Bucket): void {
    if (this.buckets.has(key)) this.buckets.delete(key);
    while (this.buckets.size >= this.maxBuckets) {
      const oldest = this.buckets.keys().next().value as string | undefined;
      if (!oldest) break;
      this.buckets.delete(oldest);
    }
    this.buckets.set(key, bucket);
  }

  private warn(policy: Policy, source: string, retryAfter: number, now: number): void {
    const key = `${policy}:${source}`;
    const prior = this.warnedAt.get(key) ?? 0;
    if (now - prior < 60_000) return;
    if (this.warnedAt.has(key)) this.warnedAt.delete(key);
    while (this.warnedAt.size >= 2_000) {
      const oldest = this.warnedAt.keys().next().value as string | undefined;
      if (!oldest) break;
      this.warnedAt.delete(oldest);
    }
    this.warnedAt.set(key, now);
    this.logger.warn(
      JSON.stringify({
        event: 'EDGE_HTTP_ABUSE_RATE_REJECT',
        policy,
        sourceFingerprint: source.slice(0, 16),
        retryAfterSeconds: retryAfter,
      }),
    );
  }
}
