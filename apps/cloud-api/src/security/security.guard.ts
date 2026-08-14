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
  AuthenticatedEdgePrincipal,
  AuthenticatedOperatorPrincipal,
} from '@event-commerce/contracts';
import { DatabaseService } from '../database/database.service';
import { CloudSecurityService } from './security.service';
import {
  CLOUD_SECURITY_ROUTE,
  type CloudSecurityRoute,
} from './security-route';

interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  params?: Record<string, string | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
  securityPrincipal?: AuthenticatedOperatorPrincipal | AuthenticatedEdgePrincipal;
}

interface LimitState {
  startedAt: number;
  count: number;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

@Injectable()
export class CloudSecurityGuard implements CanActivate {
  private readonly limits = new Map<string, LimitState>();

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(CloudSecurityService) private readonly security: CloudSecurityService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
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
      this.reflector.getAllAndOverride<CloudSecurityRoute>(CLOUD_SECURITY_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'OPERATOR';

    this.rateLimit(request, route, 'preauth');

    if (
      route === 'PUBLIC_HEALTH' ||
      route === 'PROVIDER_CALLBACK' ||
      route === 'BOOTSTRAP'
    ) {
      return true;
    }

    if (route === 'EDGE_SERVICE') {
      const principal = await this.security.authenticateEdge(request.headers.authorization);
      request.securityPrincipal = principal;
      this.rateLimit(request, route, principal.credentialId);
      return true;
    }

    if (route === 'OPERATOR_OR_EDGE') {
      const authorization = single(request.headers.authorization);
      if (authorization?.toLowerCase().startsWith('edge ')) {
        const principal = await this.security.authenticateEdge(authorization);
        request.securityPrincipal = principal;
        this.rateLimit(request, route, principal.credentialId);
        return true;
      }
      const principal = await this.security.authenticateOperator(authorization);
      this.applyOperator(request, principal);
      await this.assertOperatorEventScope(request, principal);
      this.rateLimit(request, route, principal.credentialId);
      return true;
    }

    if (route !== 'OPERATOR') throw new UnauthorizedException('Unsupported security route');
    const principal = await this.security.authenticateOperator(request.headers.authorization);
    this.applyOperator(request, principal);
    await this.assertOperatorEventScope(request, principal);
    this.rateLimit(request, route, principal.credentialId);
    return true;
  }

  private applyOperator(
    request: RequestLike,
    principal: AuthenticatedOperatorPrincipal,
  ): void {
    const requestedOrganisation = single(request.headers['x-organisation-id']);
    request.securityPrincipal = principal;
    request.headers['x-actor-id'] = principal.actorId;
    request.headers['x-role'] = principal.role;
    this.overwriteActorFields(request.body, principal.actorId);
    if (principal.role === 'ADMIN') {
      if (!principal.organisationId) {
        throw new UnauthorizedException('ADMIN credential is missing organisation scope');
      }
      request.headers['x-organisation-id'] = principal.organisationId;
      return;
    }
    if (requestedOrganisation) {
      request.headers['x-organisation-id'] = requestedOrganisation;
    } else if (principal.organisationId) {
      request.headers['x-organisation-id'] = principal.organisationId;
    } else {
      delete request.headers['x-organisation-id'];
    }
  }

  private async assertOperatorEventScope(
    request: RequestLike,
    principal: AuthenticatedOperatorPrincipal,
  ): Promise<void> {
    if (principal.role === 'PLATFORM_ADMIN') return;
    const eventId = request.params?.eventId;
    if (!eventId) return;
    if (!principal.organisationId) {
      throw new UnauthorizedException('ADMIN credential is missing organisation scope');
    }
    const rows = await this.database.query<{ organisation_id: string }>(
      `SELECT organisation_id::text
       FROM events
       WHERE id::text=$1`,
      [eventId],
    );
    const organisationId = rows[0]?.organisation_id;
    if (organisationId && organisationId !== principal.organisationId) {
      throw new ForbiddenException('Operator credential cannot access another organisation event');
    }
  }

  private overwriteActorFields(body: unknown, actorId: string): void {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return;
    const record = body as Record<string, unknown>;
    for (const key of ['actorId', 'requestingActorId', 'approvingActorId'] as const) {
      if (key in record) record[key] = actorId;
    }
  }

  private rateLimit(
    request: RequestLike,
    route: CloudSecurityRoute,
    identity: string,
  ): void {
    const now = Date.now();
    const windowMs = 60_000;
    const limit = this.limit(route);
    const remote = request.ip ?? request.socket?.remoteAddress ?? 'unknown';
    const key = `${route}:${identity}:${remote}`;
    const current = this.limits.get(key);
    if (!current || now - current.startedAt >= windowMs) {
      this.limits.set(key, { startedAt: now, count: 1 });
      this.compact(now, windowMs);
      return;
    }
    current.count += 1;
    if (current.count > limit) {
      throw new HttpException('Rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private limit(route: CloudSecurityRoute): number {
    if (process.env.NODE_ENV === 'test') {
      const override = Number(process.env.SECURITY_TEST_RATE_LIMIT_PER_MINUTE);
      if (Number.isSafeInteger(override) && override > 0) return override;
    }
    if (route === 'BOOTSTRAP') return 20;
    if (route === 'OPERATOR') return 300;
    if (route === 'OPERATOR_OR_EDGE') return 1_200;
    if (route === 'EDGE_SERVICE') return 2_400;
    if (route === 'PROVIDER_CALLBACK') return 1_200;
    return 600;
  }

  private compact(now: number, windowMs: number): void {
    if (this.limits.size < 10_000) return;
    for (const [key, state] of this.limits) {
      if (now - state.startedAt >= windowMs) this.limits.delete(key);
    }
  }
}
