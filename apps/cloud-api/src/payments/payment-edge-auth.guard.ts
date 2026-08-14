import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

interface RequestLike {
  headers?: Record<string, string | string[] | undefined>;
}

@Injectable()
export class PaymentEdgeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.CLOUD_API_BEARER_TOKEN?.trim();
    if (!expected) throw new UnauthorizedException('payment Edge authentication is not configured');

    const request = context.switchToHttp().getRequest<RequestLike>();
    const raw = request.headers?.authorization;
    const header = Array.isArray(raw) ? raw[0] : raw;
    const prefix = 'Bearer ';
    if (!header?.startsWith(prefix)) throw new UnauthorizedException('payment Edge authentication required');
    const supplied = header.slice(prefix.length);
    const expectedBytes = Buffer.from(expected, 'utf8');
    const suppliedBytes = Buffer.from(supplied, 'utf8');
    if (
      expectedBytes.length !== suppliedBytes.length ||
      !timingSafeEqual(expectedBytes, suppliedBytes)
    ) {
      throw new UnauthorizedException('payment Edge authentication failed');
    }
    return true;
  }
}
