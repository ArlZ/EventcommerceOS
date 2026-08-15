import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { classifyEdgeAbuseRequest, type EdgeAbuseRequestLike } from './edge-abuse-protection.guard';
import { EdgeAbuseProtectionService } from './edge-abuse-protection.service';

interface ResponseLike {
  setHeader(name: string, value: string): void;
}

@Injectable()
export class EdgeAbuseConcurrencyInterceptor implements NestInterceptor {
  constructor(
    @Inject(EdgeAbuseProtectionService) private readonly protection: EdgeAbuseProtectionService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<EdgeAbuseRequestLike>();
    const response = context.switchToHttp().getResponse<ResponseLike>();
    const classification = classifyEdgeAbuseRequest(request);
    if (!classification) return next.handle();

    const policy = this.protection.policy(classification.policy);
    response.setHeader('X-Concurrency-Limit', String(policy.maxInFlight));
    if (!this.protection.tryEnter(classification.policy)) {
      response.setHeader('Retry-After', '1');
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          message: 'Event Edge concurrency limit reached; retry later',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    try {
      return next.handle().pipe(finalize(() => this.protection.leave(classification.policy)));
    } catch (error) {
      this.protection.leave(classification.policy);
      throw error;
    }
  }
}
