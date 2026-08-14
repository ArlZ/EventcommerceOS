import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type {
  AuthenticatedDevicePrincipal,
  AuthenticatedOperatorPrincipal,
} from '@event-commerce/contracts';
import { EdgeSecurityService } from './security.service';
import {
  EDGE_SECURITY_ROUTE,
  type EdgeSecurityRoute,
} from './security-route';

interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  ip?: string;
  socket?: { remoteAddress?: string };
  securityPrincipal?: AuthenticatedOperatorPrincipal | AuthenticatedDevicePrincipal;
}

interface LimitState {
  startedAt: number;
  count: number;
}

@Injectable()
export class EdgeSecurityGuard implements CanActivate {
  private readonly limits = new Map<string, LimitState>();

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(EdgeSecurityService) private readonly security: EdgeSecurityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      process.env.NODE_ENV === 'test' &&
      process.env.SECURITY_TEST_BYPASS === 'true'
    ) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestLike>();
    const route =
      this.reflector.getAllAndOverride<EdgeSecurityRoute>(EDGE_SECURITY_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'OPERATOR';

    this.rateLimit(request, route, 'preauth');

    if (route === 'PUBLIC_HEALTH' || route === 'SNAPSHOT_INSTALL') return true;

    if (route === 'DEVICE') {
      const principal = await this.security.authenticateDevice(request.headers.authorization);
      request.securityPrincipal = principal;
      request.headers['x-device-id'] = principal.deviceId;
      request.headers['x-event-id'] = principal.eventId;
      request.headers['x-sales-location-id'] = principal.salesLocationId;
      this.rateLimit(request, route, principal.credentialId);
      return true;
    }

    if (route !== 'OPERATOR') throw new UnauthorizedException('Unsupported Event Edge security route');
    const principal = await this.security.authenticateOperator(request.headers.authorization);
    request.securityPrincipal = principal;
    request.headers['x-actor-id'] = principal.actorId;
    request.headers['x-role'] = principal.role;
    if (principal.organisationId) {
      request.headers['x-organisation-id'] = principal.organisationId;
    }
    this.overwriteActor(request.body, principal.actorId);
    this.rateLimit(request, route, principal.credentialId);
    return true;
  }

  private overwriteActor(body: unknown, actorId: string): void {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return;
    const record = body as Record<string, unknown>;
    if ('actorId' in record) record.actorId = actorId;
  }

  private rateLimit(
    request: RequestLike,
    route: EdgeSecurityRoute,
    identity: string,
  ): void {
    const now = Date.now();
    const windowMs = 60_000;
    const remote = request.ip ?? request.socket?.remoteAddress ?? 'unknown';
    const key = `${route}:${identity}:${remote}`;
    const current = this.limits.get(key);
    if (!current || now - current.startedAt >= windowMs) {
      this.limits.set(key, { startedAt: now, count: 1 });
      this.compact(now, windowMs);
      return;
    }
    current.count += 1;
    if (current.count > this.limit(route)) {
      throw new HttpException('Rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private limit(route: EdgeSecurityRoute): number {
    if (route === 'SNAPSHOT_INSTALL') return 30;
    if (route === 'OPERATOR') return 600;
    if (route === 'DEVICE') return 6_000;
    return 1_200;
  }

  private compact(now: number, windowMs: number): void {
    if (this.limits.size < 10_000) return;
    for (const [key, state] of this.limits) {
      if (now - state.startedAt >= windowMs) this.limits.delete(key);
    }
  }
}
