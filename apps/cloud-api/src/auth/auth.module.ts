import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseModule } from '../database/database.module';
import { AbuseProtectionModule } from '../security/abuse-protection.module';
import { GlobalSecurityGuard } from '../security/global-security.guard';
import { OperatorAuthService } from './operator-auth.service';
import { OperatorIdentityGuard } from './operator-identity.guard';

@Global()
@Module({
  imports: [DatabaseModule, AbuseProtectionModule],
  providers: [
    OperatorAuthService,
    OperatorIdentityGuard,
    {
      provide: APP_GUARD,
      useClass: GlobalSecurityGuard,
    },
  ],
  exports: [OperatorAuthService],
})
export class AuthModule {}
