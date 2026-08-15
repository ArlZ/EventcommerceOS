import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { OperatorIdentityGuard } from '../auth/operator-identity.guard';
import { AbuseProtectionGuard } from './abuse-protection.guard';

@Injectable()
export class GlobalSecurityGuard implements CanActivate {
  constructor(
    @Inject(AbuseProtectionGuard) private readonly abuse: AbuseProtectionGuard,
    @Inject(OperatorIdentityGuard) private readonly operatorIdentity: OperatorIdentityGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const withinRate = this.abuse.canActivate(context);
    if (!withinRate) return false;
    return this.operatorIdentity.canActivate(context);
  }
}
