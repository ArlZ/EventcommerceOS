import { ForbiddenException, UnauthorizedException } from '@nestjs/common';

export interface AdminContext {
  actorId: string;
  organisationId?: string;
  role: 'ADMIN' | 'PLATFORM_ADMIN';
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function adminContextFromHeaders(
  headers: Record<string, string | string[] | undefined>,
  organisationRequired = true,
): AdminContext {
  const actorId = singleHeader(headers['x-actor-id']);
  const role = singleHeader(headers['x-role']);
  const organisationId = singleHeader(headers['x-organisation-id']);

  if (!actorId || !isUuid(actorId)) {
    throw new UnauthorizedException('authenticated operator identity is required');
  }
  if (role !== 'ADMIN' && role !== 'PLATFORM_ADMIN') {
    throw new ForbiddenException('Administrative role required');
  }
  if (!organisationRequired && role !== 'PLATFORM_ADMIN') {
    throw new ForbiddenException('Platform administrator required');
  }
  if (organisationRequired && (!organisationId || !isUuid(organisationId))) {
    throw new UnauthorizedException('x-organisation-id must select an authorized organisation');
  }
  if (organisationId && !isUuid(organisationId)) {
    throw new UnauthorizedException('x-organisation-id must be a UUID');
  }

  return { actorId, role, ...(organisationId ? { organisationId } : {}) };
}

export function assertOrganisationAccess(context: AdminContext, organisationId: string): void {
  if (context.role === 'PLATFORM_ADMIN') return;
  if (context.organisationId !== organisationId) {
    throw new ForbiddenException('Cross-organisation access is not allowed');
  }
}
