import { BadRequestException } from '@nestjs/common';
import type { SecurityOperatorRole } from '@event-commerce/contracts';
import { bodyObject, integer, requiredString, uuid } from '../configuration/validation';

export interface BootstrapOperatorInput {
  organisationId: string;
  actorId: string;
  label: string;
  expiresInMinutes: number;
}

export interface ProvisionOperatorInput extends BootstrapOperatorInput {
  role: SecurityOperatorRole;
}

export interface ProvisionDeviceInput {
  deviceId: string;
  salesLocationId: string;
  label: string;
  expiresInMinutes: number;
}

export interface ProvisionEdgeInput {
  edgeId: string;
  label: string;
  expiresInMinutes: number;
}

export interface CredentialMutationInput {
  reason: string;
  expiresInMinutes?: number;
}

function only(body: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  const unexpected = Object.keys(body).filter((key) => !allowedSet.has(key)).sort();
  if (unexpected.length > 0) {
    throw new BadRequestException(`Unexpected security field: ${unexpected[0]}`);
  }
}

function minutes(
  body: Record<string, unknown>,
  defaultValue: number,
  maximum: number,
): number {
  if (body.expiresInMinutes === undefined) return defaultValue;
  const value = integer(body.expiresInMinutes, 'expiresInMinutes', 5);
  if (value > maximum) {
    throw new BadRequestException(`expiresInMinutes must be <= ${maximum}`);
  }
  return value;
}

export function parseBootstrapOperator(value: unknown): BootstrapOperatorInput {
  const body = bodyObject(value);
  only(body, ['organisationId', 'actorId', 'label', 'expiresInMinutes']);
  return {
    organisationId: uuid(requiredString(body, 'organisationId'), 'organisationId'),
    actorId: uuid(requiredString(body, 'actorId'), 'actorId'),
    label: requiredString(body, 'label'),
    expiresInMinutes: minutes(body, 720, 1_440),
  };
}

export function parseProvisionOperator(value: unknown): ProvisionOperatorInput {
  const body = bodyObject(value);
  only(body, ['organisationId', 'actorId', 'role', 'label', 'expiresInMinutes']);
  const role = requiredString(body, 'role').toUpperCase();
  if (role !== 'ADMIN' && role !== 'PLATFORM_ADMIN') {
    throw new BadRequestException('role must be ADMIN or PLATFORM_ADMIN');
  }
  return {
    organisationId: uuid(requiredString(body, 'organisationId'), 'organisationId'),
    actorId: uuid(requiredString(body, 'actorId'), 'actorId'),
    role,
    label: requiredString(body, 'label'),
    expiresInMinutes: minutes(body, 720, 1_440),
  };
}

export function parseProvisionDevice(value: unknown): ProvisionDeviceInput {
  const body = bodyObject(value);
  only(body, ['deviceId', 'salesLocationId', 'label', 'expiresInMinutes']);
  return {
    deviceId: requiredString(body, 'deviceId'),
    salesLocationId: uuid(requiredString(body, 'salesLocationId'), 'salesLocationId'),
    label: requiredString(body, 'label'),
    expiresInMinutes: minutes(body, 43_200, 43_200),
  };
}

export function parseProvisionEdge(value: unknown): ProvisionEdgeInput {
  const body = bodyObject(value);
  only(body, ['edgeId', 'label', 'expiresInMinutes']);
  return {
    edgeId: requiredString(body, 'edgeId'),
    label: requiredString(body, 'label'),
    expiresInMinutes: minutes(body, 43_200, 43_200),
  };
}

export function parseCredentialMutation(
  value: unknown,
  rotation: boolean,
): CredentialMutationInput {
  const body = bodyObject(value);
  only(body, rotation ? ['reason', 'expiresInMinutes'] : ['reason']);
  return {
    reason: requiredString(body, 'reason'),
    ...(rotation ? { expiresInMinutes: minutes(body, 720, 43_200) } : {}),
  };
}

export function credentialKind(value: string): 'operator' | 'device' | 'edge' {
  if (value === 'operator' || value === 'device' || value === 'edge') return value;
  throw new BadRequestException('credential kind must be operator, device or edge');
}
