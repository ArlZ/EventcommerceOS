import { Global, Module } from '@nestjs/common';
import { OperatorAuthController } from './operator-auth.controller';
import { OperatorAdminGuard, OperatorGuard } from './operator-auth.guard';
import { OperatorAuthService } from './operator-auth.service';

@Global()
@Module({
  controllers: [OperatorAuthController],
  providers: [OperatorAuthService, OperatorGuard, OperatorAdminGuard],
  exports: [OperatorAuthService, OperatorGuard, OperatorAdminGuard],
})
export class OperatorAuthModule {}
