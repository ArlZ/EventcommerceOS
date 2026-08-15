import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  EdgeAbuseProtectionService,
  type EdgeAbusePolicyName,
} from './edge-abuse-protection.service';

type HeaderValue = string | string[] | undefined;

export interface EdgeAbuseRequestLike {
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

export interface EdgeAbuseClassification {
  policy: EdgeAbusePolicyName;
  principal?: string | undefined;
}

function first(value: HeaderValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function pathOf(request: EdgeAbuseRequestLike): string {
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

export function classifyEdgeAbuseRequest(
  request: EdgeAbuseRequestLike,
): EdgeAbuseClassification | undefined {
  if ((request.method ?? 'GET').toUpperCase() === 'OPTIONS') return undefined;
  const path = pathOf(request);
  const authorization = first(request.headers.authorization)?.trim() ?? '';
  const deviceId = first(request.headers['x-device-id'])?.trim() ?? '';
  const principal =
    deviceId || authorization ? hash(`device:${deviceId}:${authorization}`) : undefined;

  if (path === '/sync/device-events') return { policy: 'DEVICE_SYNC', principal };
  if (isDevicePayment(path)) return { policy: 'DEVICE_PAYMENT', principal };
  return { policy: 'LOCAL_OTHER', principal };
}

@Injectable()
export class EdgeAbuseProtectionGuard implements CanActivate {
  private readonly logger = new Logger(EdgeAbuseProtectionGuard.name);
  private readonly warnedAt = new Map<string, number>();

  constructor(
    @Inject(EdgeAbuseProtectionService) private readonly protection: EdgeAbuseProtectionService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<EdgeAbuseRequestLike>();
    const response = context.switchToHttp().getResponse<ResponseLike>();
    const classification = classifyEdgeAbuseRequest(request);
    if (!classification) return true;

    const now = Date.now();
    const source = hash(request.ip ?? request.socket?.remoteAddress ?? 'unknown');
    const decisions = [this.protection.consume(classification.policy, `source:${source}`, now)];
    if (classification.principal) {
      decisions.push(
        this.protection.consume(
          classification.policy,
          `principal:${classification.principal}`,
          now,
        ),
      );
    }

    const policy = this.protection.policy(classification.policy);
    const remaining = Math.min(...decisions.map((item) => item.remaining));
    response.setHeader('X-RateLimit-Policy', classification.policy);
    response.setHeader('X-RateLimit-Limit', String(policy.requestsPerMinute));
    response.setHeader('X-RateLimit-Burst', String(policy.burst));
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

  private warn(
    policy: EdgeAbusePolicyName,
    source: string,
    retryAfter: number,
    now: number,
  ): void {
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
