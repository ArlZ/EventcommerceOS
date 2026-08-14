import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { OperatorAuthService, type OperatorIdentity } from './operator-auth.service';

export interface OperatorRequest {
  headers: Record<string, string | string[] | undefined>;
  operatorIdentity?: OperatorIdentity;
}

function requestFrom(context: ExecutionContext): OperatorRequest {
  return context.switchToHttp().getRequest<OperatorRequest>();
}

function attachIdentity(request: OperatorRequest, identity: OperatorIdentity): void {
  request.operatorIdentity = identity;
}

function attachLegacyAdminContext(request: OperatorRequest, identity: OperatorIdentity): void {
  attachIdentity(request, identity);
  request.headers['x-actor-id'] = identity.actorId;
  request.headers['x-role'] = identity.role;
  if (identity.organisationId === null) delete request.headers['x-organisation-id'];
  else request.headers['x-organisation-id'] = identity.organisationId;
}

@Injectable()
export class OperatorGuard implements CanActivate {
  constructor(@Inject(OperatorAuthService) protected readonly auth: OperatorAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = requestFrom(context);
    attachIdentity(request, await this.auth.authenticateHeaders(request.headers));
    return true;
  }
}

@Injectable()
export class OperatorAdminGuard implements CanActivate {
  constructor(@Inject(OperatorAuthService) private readonly auth: OperatorAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = requestFrom(context);
    const identity = await this.auth.authenticateHeaders(request.headers);
    this.auth.requireRole(identity, ['ADMIN', 'PLATFORM_ADMIN']);
    attachLegacyAdminContext(request, identity);
    return true;
  }
}

@Injectable()
export class LegacyAdminBoundaryGuard implements CanActivate {
  private readonly protectedControllers = new Set([
    'ConfigurationController',
    'CommandCentreController',
    'EventCloseController',
  ]);

  constructor(@Inject(OperatorAuthService) private readonly auth: OperatorAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.protectedControllers.has(context.getClass().name)) return true;
    const request = requestFrom(context);
    const identity = await this.auth.authenticateHeaders(request.headers);
    this.auth.requireRole(identity, ['ADMIN', 'PLATFORM_ADMIN']);
    attachLegacyAdminContext(request, identity);
    return true;
  }
}

export const CurrentOperator = createParamDecorator(
  (_data: unknown, context: ExecutionContext): OperatorIdentity => {
    const identity = requestFrom(context).operatorIdentity;
    if (!identity) throw new UnauthorizedException('Authenticated operator context is missing');
    return identity;
  },
);
