import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { OperatorAuthController } from './operator-auth.controller';
import {
  LegacyAdminBoundaryGuard,
  OperatorAdminGuard,
  OperatorGuard,
} from './operator-auth.guard';
import { OperatorAuthService } from './operator-auth.service';

@Global()
@Module({
  controllers: [OperatorAuthController],
  providers: [
    OperatorAuthService,
    OperatorGuard,
    OperatorAdminGuard,
    LegacyAdminBoundaryGuard,
    { provide: APP_GUARD, useExisting: LegacyAdminBoundaryGuard },
  ],
  exports: [OperatorAuthService, OperatorGuard, OperatorAdminGuard],
})
export class OperatorAuthModule {}
