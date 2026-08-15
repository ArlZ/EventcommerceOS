import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseModule } from '../database/database.module';
import { OperatorAuthService } from './operator-auth.service';
import { OperatorIdentityGuard } from './operator-identity.guard';

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [
    OperatorAuthService,
    {
      provide: APP_GUARD,
      useClass: OperatorIdentityGuard,
    },
  ],
  exports: [OperatorAuthService],
})
export class AuthModule {}
