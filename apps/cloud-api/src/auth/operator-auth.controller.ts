import { BadRequestException, Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentOperator, OperatorGuard } from './operator-auth.guard';
import { OperatorAuthService, type OperatorIdentity } from './operator-auth.service';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('Operator session request must be an object');
  }
  return value as Record<string, unknown>;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new BadRequestException(`${key} must be a non-empty string`);
  }
  return value.trim();
}

@Controller('auth/operator')
export class OperatorAuthController {
  constructor(private readonly auth: OperatorAuthService) {}

  @Post('session')
  createSession(@Body() body: unknown) {
    const record = object(body);
    return this.auth.createSession(
      requiredString(record, 'actorId'),
      requiredString(record, 'credential'),
    );
  }

  @Post('revoke-sessions')
  @UseGuards(OperatorGuard)
  revokeSessions(@CurrentOperator() identity: OperatorIdentity) {
    return this.auth.revokeOwnSessions(identity);
  }
}
