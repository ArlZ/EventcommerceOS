import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { OperatorAuthService, type HeadersRecord } from './operator-auth.service';

interface HttpRequest {
  headers: HeadersRecord;
  path?: string;
  url?: string;
}

function requestPath(request: HttpRequest): string {
  return (request.path ?? request.url ?? '/').split('?', 1)[0] || '/';
}

function isPublicOperatorAuthPath(path: string): boolean {
  return (
    path === '/operator-auth/login/password' ||
    path === '/operator-auth/login/resend' ||
    path === '/operator-auth/login/verify' ||
    path === '/operator-auth/logout'
  );
}

@Injectable()
export class OperatorIdentityGuard implements CanActivate {
  constructor(@Inject(OperatorAuthService) private readonly operators: OperatorAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<HttpRequest>();

    // Caller-supplied actor/role headers are never trusted. They are removed on every request,
    // including machine/provider routes, before any controller can inspect them.
    delete request.headers['x-actor-id'];
    delete request.headers['x-role'];

    // A stale browser session must never prevent the operator from reaching the login or logout
    // endpoints that can replace/clear it. Those endpoints perform their own proof checks.
    if (isPublicOperatorAuthPath(requestPath(request))) return true;

    if (!this.operators.isOperatorAuthorization(request.headers)) return true;

    const projection = await this.operators.legacyProjection(request.headers);
    request.headers['x-actor-id'] = projection.actorId;
    if (projection.role) request.headers['x-role'] = projection.role;
    if (projection.organisationId) request.headers['x-organisation-id'] = projection.organisationId;
    return true;
  }
}
