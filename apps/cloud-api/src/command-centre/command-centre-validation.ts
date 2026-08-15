import { BadRequestException } from '@nestjs/common';
import type { CommandCentreInventoryAlertActionRequest } from '@event-commerce/contracts';
import { bodyObject, uuid } from '../configuration/validation';

export function parseInventoryAlertAction(
  value: unknown,
): CommandCentreInventoryAlertActionRequest {
  const body = bodyObject(value);
  const allowed = new Set(['action', 'assignedActorId']);
  const unexpected = Object.keys(body)
    .filter((key) => !allowed.has(key))
    .sort();
  if (unexpected.length > 0) {
    throw new BadRequestException(`Unexpected command centre action field: ${unexpected[0]}`);
  }

  const action = body.action;
  if (action !== 'ACKNOWLEDGE' && action !== 'ASSIGN') {
    throw new BadRequestException('action must be ACKNOWLEDGE or ASSIGN');
  }

  if (action === 'ACKNOWLEDGE') {
    if (body.assignedActorId !== undefined) {
      throw new BadRequestException('assignedActorId is only valid for ASSIGN');
    }
    return { action };
  }

  if (typeof body.assignedActorId !== 'string' || !body.assignedActorId.trim()) {
    throw new BadRequestException('assignedActorId is required for ASSIGN');
  }
  return { action, assignedActorId: uuid(body.assignedActorId.trim(), 'assignedActorId') };
}
