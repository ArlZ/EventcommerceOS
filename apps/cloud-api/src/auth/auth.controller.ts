import { BadRequestException, Body, Controller, Get, Headers, Inject, Post } from '@nestjs/common';
import { HumanAuthService } from './human-auth.service';

type HeadersRecord = Record<string, string | string[] | undefined>;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('body must be an object');
  }
  return value as Record<string, unknown>;
}

function text(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new BadRequestException(`${key} must be a non-empty string`);
  }
  return value.trim();
}

@Controller('auth')
export class AuthController {
  constructor(@Inject(HumanAuthService) private readonly auth: HumanAuthService) {}

  @Post('login')
  login(@Body() body: unknown) {
    const input = object(body);
    const organisation = input.organisationId;
    if (organisation !== undefined && (typeof organisation !== 'string' || !organisation.trim())) {
      throw new BadRequestException('organisationId must be a non-empty string when provided');
    }
    return this.auth.login(
      text(input, 'email'),
      text(input, 'password'),
      typeof organisation === 'string' ? organisation.trim() : undefined,
    );
  }

  @Post('logout')
  logout(@Headers() headers: HeadersRecord) {
    return this.auth.logout(headers);
  }

  @Get('session')
  session(@Headers() headers: HeadersRecord) {
    return this.auth.authenticate(headers);
  }
}
