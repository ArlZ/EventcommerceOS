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

@Injectable()
export class OperatorGuard implements CanActivate {
  constructor(@Inject(OperatorAuthService) protected readonly auth: OperatorAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = requestFrom(context);
    request.operatorIdentity = await this.auth.authenticateHeaders(request.headers);
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
    request.operatorIdentity = identity;

    // Existing admin services accept AdminContext derived from these headers. They are overwritten only
    // after cryptographic authentication so externally supplied actor/role/organisation headers have no authority.
    request.headers['x-actor-id'] = identity.actorId;
    request.headers['x-role'] = identity.role;
    if (identity.organisationId === null) delete request.headers['x-organisation-id'];
    else request.headers['x-organisation-id'] = identity.organisationId;
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
