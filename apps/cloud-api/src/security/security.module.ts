import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseModule } from '../database/database.module';
import { CredentialAdministrationPolicyService } from './credential-administration-policy.service';
import { EdgeScopeService } from './edge-scope.service';
import { SecurityController } from './security.controller';
import { CloudSecurityGuard } from './security.guard';
import { CloudSecurityService } from './security.service';

@Module({
  imports: [DatabaseModule],
  controllers: [SecurityController],
  providers: [
    CloudSecurityService,
    EdgeScopeService,
    CredentialAdministrationPolicyService,
    { provide: APP_GUARD, useClass: CloudSecurityGuard },
  ],
  exports: [CloudSecurityService, EdgeScopeService],
})
export class SecurityModule {}
