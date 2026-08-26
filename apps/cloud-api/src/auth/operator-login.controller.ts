import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Post,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { OperatorAuthService, type HeadersRecord } from './operator-auth.service';
import { OperatorContextService, type OperatorControlContext } from './operator-context.service';
import {
  clearOperatorLoginCookie,
  clearOperatorSessionCookie,
  cookieValue,
  OPERATOR_LOGIN_COOKIE,
  operatorLoginCookie,
  operatorSessionCookie,
} from './operator-cookie';
import type { OperatorLoginProfile } from './operator-login.service';
import { OperatorLoginService } from './operator-login.service';

interface CookieResponse {
  setHeader(name: string, value: string | string[]): void;
}

@Controller('operator-auth')
export class OperatorLoginController {
  constructor(
    @Inject(OperatorLoginService) private readonly login: OperatorLoginService,
    @Inject(OperatorAuthService) private readonly operators: OperatorAuthService,
    @Inject(OperatorContextService) private readonly operatorContext: OperatorContextService,
  ) {}

  @Post('login/password')
  async password(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<{ maskedEmail: string; resendAfterSeconds: number }> {
    const result = await this.login.begin(body);
    response.setHeader('Set-Cookie', operatorLoginCookie(result.challengeToken));
    return {
      maskedEmail: result.maskedEmail,
      resendAfterSeconds: result.resendAfterSeconds,
    };
  }

  @Post('login/resend')
  resend(@Headers() headers: HeadersRecord): Promise<{ resendAfterSeconds: number }> {
    return this.login.resend(cookieValue(headers, OPERATOR_LOGIN_COOKIE));
  }

  @Post('login/verify')
  async verify(
    @Headers() headers: HeadersRecord,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<{ profile: OperatorLoginProfile }> {
    const result = await this.login.complete(cookieValue(headers, OPERATOR_LOGIN_COOKIE), body);
    response.setHeader('Set-Cookie', [
      operatorSessionCookie(result.sessionToken, result.rememberDevice),
      clearOperatorLoginCookie(),
    ]);
    return { profile: result.profile };
  }

  @Get('session')
  async session(@Headers() headers: HeadersRecord): Promise<{ profile: OperatorLoginProfile }> {
    const identity = await this.operators.authenticate(headers);
    return { profile: await this.login.profile(identity.actorId) };
  }

  @Get('context')
  context(@Headers() headers: HeadersRecord): Promise<OperatorControlContext> {
    return this.operatorContext.context(headers);
  }

  @Post('logout')
  async logout(
    @Headers() headers: HeadersRecord,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<{ status: 'signed_out' }> {
    response.setHeader('Set-Cookie', [clearOperatorSessionCookie(), clearOperatorLoginCookie()]);
    try {
      await this.operators.revokeSession(headers);
    } catch (error) {
      if (!(error instanceof UnauthorizedException)) throw error;
    }
    return { status: 'signed_out' };
  }
}
