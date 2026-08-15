import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { OperatorIdentityGuard } from '../auth/operator-identity.guard';
import {
  AbuseProtectionGuard,
  classifyAbuseRequest,
  type AbuseRequestLike,
} from './abuse-protection.guard';
import { AbuseProtectionService } from './abuse-protection.service';

interface HttpResponse {
  setHeader(name: string, value: string): void;
}

@Injectable()
export class GlobalSecurityGuard implements CanActivate {
  constructor(
    @Inject(AbuseProtectionGuard) private readonly abuse: AbuseProtectionGuard,
    @Inject(OperatorIdentityGuard) private readonly operatorIdentity: OperatorIdentityGuard,
    @Inject(AbuseProtectionService) private readonly protection: AbuseProtectionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const withinRate = this.abuse.canActivate(context);
    if (!withinRate) return false;

    if (context.getType() !== 'http') return this.operatorIdentity.canActivate(context);
    const request = context.switchToHttp().getRequest<AbuseRequestLike>();
    const classified = classifyAbuseRequest(request);
    if (classified?.principalType !== 'operator') {
      return this.operatorIdentity.canActivate(context);
    }

    const policy = this.protection.policy(classified.policy);
    const response = context.switchToHttp().getResponse<HttpResponse>();
    response.setHeader('X-Auth-Concurrency-Limit', String(policy.maxInFlight));
    if (!this.protection.tryEnter(classified.policy)) {
      response.setHeader('Retry-After', '1');
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          message: 'Operator authentication concurrency limit reached; retry later',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    try {
      return await this.operatorIdentity.canActivate(context);
    } finally {
      this.protection.leave(classified.policy);
    }
  }
}
