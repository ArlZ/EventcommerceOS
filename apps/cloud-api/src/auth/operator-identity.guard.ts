import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { OperatorAuthService, type HeadersRecord } from './operator-auth.service';

interface HttpRequest {
  headers: HeadersRecord;
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

    if (!this.operators.isOperatorAuthorization(request.headers)) return true;

    const projection = await this.operators.legacyProjection(request.headers);
    request.headers['x-actor-id'] = projection.actorId;
    if (projection.role) request.headers['x-role'] = projection.role;
    if (projection.organisationId) request.headers['x-organisation-id'] = projection.organisationId;
    return true;
  }
}
