import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  OperatorEdgeAuthService,
  type EdgeOperatorIdentity,
} from './operator-edge-auth.service';

export interface EdgeOperatorRequest {
  headers: Record<string, string | string[] | undefined>;
  operatorIdentity?: EdgeOperatorIdentity;
}

function requestFrom(context: ExecutionContext): EdgeOperatorRequest {
  return context.switchToHttp().getRequest<EdgeOperatorRequest>();
}

@Injectable()
export class OperatorEdgeGuard implements CanActivate {
  constructor(@Inject(OperatorEdgeAuthService) private readonly auth: OperatorEdgeAuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = requestFrom(context);
    request.operatorIdentity = this.auth.authenticateHeaders(request.headers);
    return true;
  }
}

export const CurrentEdgeOperator = createParamDecorator(
  (_data: unknown, context: ExecutionContext): EdgeOperatorIdentity => {
    const identity = requestFrom(context).operatorIdentity;
    if (!identity) throw new UnauthorizedException('Authenticated Edge operator context is missing');
    return identity;
  },
);
