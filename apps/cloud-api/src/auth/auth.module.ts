import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseModule } from '../database/database.module';
import { AbuseProtectionModule } from '../security/abuse-protection.module';
import { GlobalSecurityGuard } from '../security/global-security.guard';
import { OperatorAuthService } from './operator-auth.service';
import { OperatorContextService } from './operator-context.service';
import { OperatorIdentityGuard } from './operator-identity.guard';
import { OperatorLoginController } from './operator-login.controller';
import { OperatorLoginService } from './operator-login.service';
import { SupabaseAuthTransport } from './supabase-auth.transport';

@Global()
@Module({
  imports: [DatabaseModule, AbuseProtectionModule],
  controllers: [OperatorLoginController],
  providers: [
    OperatorAuthService,
    OperatorContextService,
    OperatorIdentityGuard,
    OperatorLoginService,
    SupabaseAuthTransport,
    {
      provide: APP_GUARD,
      useClass: GlobalSecurityGuard,
    },
  ],
  exports: [OperatorAuthService, SupabaseAuthTransport],
})
export class AuthModule {}
