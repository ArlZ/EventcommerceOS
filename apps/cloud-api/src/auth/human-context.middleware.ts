import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import { HumanAuthService } from './human-auth.service';

interface MiddlewareRequest {
  method?: string;
  originalUrl?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}

interface MiddlewareResponse {}
type Next = (error?: unknown) => void;

function pathOf(request: MiddlewareRequest): string {
  const raw = request.originalUrl ?? request.url ?? '/';
  return raw.split('?')[0] ?? '/';
}

function isMachineOrPublic(method: string, path: string): boolean {
  if (method === 'OPTIONS') return true;
  if (path === '/health' || path === '/health/live' || path === '/health/ready') return true;
  if (path === '/auth/login' || path === '/auth/logout' || path === '/auth/session') return true;
  if (path === '/sync/edge-events') return true;
  if (path === '/inventory/edge-events') return true;
  if (/^\/payments\/providers\/[^/]+\/callback$/.test(path)) return true;
  if (path === '/payments/initiate') return true;
  if (/^\/payments\/attempts\/[^/]+\/reconcile$/.test(path)) return true;
  if (path === '/payments/providers/availability') return true;
  if (/^\/payments\/orders\/[^/]+$/.test(path)) return true;
  return false;
}

function stripCallerContext(headers: MiddlewareRequest['headers']): void {
  delete headers['x-actor-id'];
  delete headers['x-role'];
  delete headers['x-organisation-id'];
}

@Injectable()
export class HumanContextMiddleware implements NestMiddleware {
  constructor(@Inject(HumanAuthService) private readonly auth: HumanAuthService) {}

  async use(request: MiddlewareRequest, _response: MiddlewareResponse, next: Next): Promise<void> {
    stripCallerContext(request.headers);
    const method = (request.method ?? 'GET').toUpperCase();
    const path = pathOf(request);
    if (isMachineOrPublic(method, path)) {
      next();
      return;
    }

    try {
      const context = await this.auth.adminContext(request.headers, false);
      request.headers['x-actor-id'] = context.actorId;
      request.headers['x-role'] = context.role;
      if (context.organisationId) request.headers['x-organisation-id'] = context.organisationId;
      next();
    } catch (error) {
      next(error);
    }
  }
}
