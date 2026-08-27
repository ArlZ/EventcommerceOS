import { BadRequestException } from '@nestjs/common';
import type { CommandCentreInventoryAlertActionRequest } from '@event-commerce/contracts';
import { bodyObject } from '../configuration/validation';

export function parseInventoryAlertAction(
  value: unknown,
): CommandCentreInventoryAlertActionRequest {
  const body = bodyObject(value);
  const allowed = new Set(['action']);
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

  return { action };
}
