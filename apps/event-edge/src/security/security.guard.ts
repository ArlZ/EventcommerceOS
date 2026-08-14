import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
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
import { EdgeDatabaseService } from '../database/database.service';
import { EdgeSecurityService } from './security.service';
import {
  EDGE_SECURITY_ROUTE,
  type EdgeSecurityRoute,
} from './security-route';

interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  params?: Record<string, string | undefined>;
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
    @Inject(EdgeDatabaseService) private readonly database: EdgeDatabaseService,
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
      this.assertRequestEventScope(request, principal.eventId);
      this.rateLimit(request, route, principal.credentialId);
      return true;
    }

    if (route !== 'OPERATOR') throw new UnauthorizedException('Unsupported Event Edge security route');
    const authenticated = await this.security.authenticateOperator(request.headers.authorization);
    const eventId = await this.operatorEventId(authenticated.credentialId);
    const principal: AuthenticatedOperatorPrincipal = { ...authenticated, eventId };
    request.securityPrincipal = principal;
    request.headers['x-actor-id'] = principal.actorId;
    request.headers['x-role'] = principal.role;
    request.headers['x-event-id'] = eventId;
    if (principal.organisationId) {
      request.headers['x-organisation-id'] = principal.organisationId;
    }
    this.assertRequestEventScope(request, eventId);
    this.overwriteActor(request.body, principal.actorId);
    this.rateLimit(request, route, principal.credentialId);
    return true;
  }

  private async operatorEventId(credentialId: string): Promise<string> {
    const rows = await this.database.query<{ event_id: string }>(
      `SELECT event_id FROM edge_security_operator_credentials WHERE credential_id=$1`,
      [credentialId],
    );
    const eventId = rows[0]?.event_id;
    if (!eventId) throw new UnauthorizedException('Operator credential event scope is unavailable');
    return eventId;
  }

  private assertRequestEventScope(request: RequestLike, eventId: string): void {
    const pathEventId = request.params?.eventId;
    if (pathEventId && pathEventId !== eventId) {
      throw new ForbiddenException('Credential cannot access another event');
    }
    if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) return;
    const bodyEventId = (request.body as Record<string, unknown>).eventId;
    if (bodyEventId !== undefined && bodyEventId !== eventId) {
      throw new ForbiddenException('Credential cannot act on another event');
    }
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
    if (process.env.NODE_ENV === 'test') {
      const override = Number(process.env.SECURITY_TEST_RATE_LIMIT_PER_MINUTE);
      if (Number.isSafeInteger(override) && override > 0) return override;
    }
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
