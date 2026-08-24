import { Controller, Get, Headers, Inject } from '@nestjs/common';
import { OperatorAuthService, type HeadersRecord } from './operator-auth.service';

@Controller('auth/operator')
export class OperatorAuthController {
  constructor(@Inject(OperatorAuthService) private readonly operators: OperatorAuthService) {}

  @Get('session')
  session(@Headers() headers: HeadersRecord) {
    return this.operators.sessionView(headers);
  }
}
