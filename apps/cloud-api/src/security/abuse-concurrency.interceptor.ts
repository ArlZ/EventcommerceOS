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
import {
  classifyAbuseRequest,
  type AbuseRequestLike,
} from './abuse-protection.guard';
import { AbuseProtectionService } from './abuse-protection.service';

interface HttpResponse {
  setHeader(name: string, value: string): void;
}

@Injectable()
export class AbuseConcurrencyInterceptor implements NestInterceptor {
  constructor(@Inject(AbuseProtectionService) private readonly protection: AbuseProtectionService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<AbuseRequestLike>();
    const response = context.switchToHttp().getResponse<HttpResponse>();
    const classified = classifyAbuseRequest(request);
    if (!classified) return next.handle();

    const policy = this.protection.policy(classified.policy);
    response.setHeader('X-Concurrency-Limit', String(policy.maxInFlight));
    if (!this.protection.tryEnter(classified.policy)) {
      response.setHeader('Retry-After', '1');
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          message: 'Server concurrency limit reached; retry later',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    try {
      return next.handle().pipe(finalize(() => this.protection.leave(classified.policy)));
    } catch (error) {
      this.protection.leave(classified.policy);
      throw error;
    }
  }
}
