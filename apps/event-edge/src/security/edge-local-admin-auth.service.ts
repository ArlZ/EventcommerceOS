import { timingSafeEqual } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';

export type EdgeLocalAdminHeaders = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function bearer(headers: EdgeLocalAdminHeaders): string | undefined {
  const raw = first(headers.authorization)?.trim();
  if (!raw) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(raw);
  return match?.[1]?.trim();
}

function equalSecret(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected, 'utf8');
  const actualBytes = Buffer.from(actual, 'utf8');
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

@Injectable()
export class EdgeLocalAdminAuthService {
  authorize(headers: EdgeLocalAdminHeaders): void {
    const configured = process.env.EDGE_LOCAL_ADMIN_TOKEN?.trim();

    // Keep local development friction low, but production Event Edge admin routes
    // fail closed unless the venue runtime explicitly configures a strong secret.
    if (!configured) {
      if (process.env.NODE_ENV === 'production') {
        throw new UnauthorizedException('Event Edge local admin access is not configured');
      }
      return;
    }

    if (configured.length < 32) {
      throw new UnauthorizedException('Event Edge local admin access is not configured');
    }

    const presented = bearer(headers);
    if (!presented || !equalSecret(configured, presented)) {
      throw new UnauthorizedException('Invalid Event Edge local admin credential');
    }
  }
}
