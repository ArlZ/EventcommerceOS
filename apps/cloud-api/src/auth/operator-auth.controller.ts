import { Controller, Get, Headers } from '@nestjs/common';
import { OperatorAuthService, type HeadersRecord } from './operator-auth.service';

@Controller('auth/operator')
export class OperatorAuthController {
  constructor(private readonly operators: OperatorAuthService) {}

  @Get('session')
  session(@Headers() headers: HeadersRecord) {
    return this.operators.sessionView(headers);
  }
}
