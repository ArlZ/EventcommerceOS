import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

interface RequestLike {
  headers?: Record<string, string | string[] | undefined>;
}

@Injectable()
export class PaymentDeviceAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.EDGE_PAYMENT_BEARER_TOKEN?.trim();
    if (!expected) throw new UnauthorizedException('payment device authentication is not configured');

    const request = context.switchToHttp().getRequest<RequestLike>();
    const raw = request.headers?.authorization;
    const header = Array.isArray(raw) ? raw[0] : raw;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('payment device authentication required');
    }
    const supplied = header.slice('Bearer '.length);
    const expectedBytes = Buffer.from(expected, 'utf8');
    const suppliedBytes = Buffer.from(supplied, 'utf8');
    if (
      expectedBytes.length !== suppliedBytes.length ||
      !timingSafeEqual(expectedBytes, suppliedBytes)
    ) {
      throw new UnauthorizedException('payment device authentication failed');
    }
    return true;
  }
}
