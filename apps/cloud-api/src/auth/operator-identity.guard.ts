import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { OperatorAuthService, type HeadersRecord } from './operator-auth.service';

interface HttpRequest {
  method?: string;
  headers: HeadersRecord;
  path?: string;
  url?: string;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
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

function hasOperatorCookie(headers: HeadersRecord): boolean {
  const raw = first(headers.cookie);
  return Boolean(raw?.split(';').some((part) => part.trim().startsWith('ec_operator_session=ecom_op_')));
}

function hasOperatorBearer(headers: HeadersRecord): boolean {
  return first(headers.authorization)?.startsWith('Bearer ecom_op_') ?? false;
}

function requireBrowserRequest(headers: HeadersRecord): void {
  if (first(headers['x-event-control-request'])?.trim() !== 'browser') {
    throw new ForbiddenException('Event Control browser request marker required');
  }
}

@Injectable()
export class OperatorIdentityGuard implements CanActivate {
  constructor(@Inject(OperatorAuthService) private readonly operators: OperatorAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<HttpRequest>();

    // Browser CORS preflight does not carry the actual custom request marker or cookies.
    // Let Nest's CORS middleware answer it; the real request is checked below.
    if ((request.method ?? '').toUpperCase() === 'OPTIONS') return true;

    // Caller-supplied actor/role headers are never trusted. They are removed on every request,
    // including machine/provider routes, before any controller can inspect them.
    delete request.headers['x-actor-id'];
    delete request.headers['x-role'];

    const path = requestPath(request);
    if (isPublicOperatorAuthPath(path)) {
      requireBrowserRequest(request.headers);
      return true;
    }

    // Cookie sessions are browser-only. A custom request header forces a CORS preflight and blocks
    // ordinary cross-site form submissions; bearer sessions remain available for CLI operations.
    if (hasOperatorCookie(request.headers) && !hasOperatorBearer(request.headers)) {
      requireBrowserRequest(request.headers);
    }

    if (!this.operators.isOperatorAuthorization(request.headers)) return true;

    const projection = await this.operators.legacyProjection(request.headers);
    request.headers['x-actor-id'] = projection.actorId;
    if (projection.role) request.headers['x-role'] = projection.role;
    if (projection.organisationId) request.headers['x-organisation-id'] = projection.organisationId;
    return true;
  }
}
