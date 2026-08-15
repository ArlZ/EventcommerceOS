import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AbuseProtectionGuard } from './abuse-protection.guard';
import { AbuseProtectionService } from './abuse-protection.service';

@Global()
@Module({
  providers: [
    AbuseProtectionService,
    {
      provide: APP_GUARD,
      useClass: AbuseProtectionGuard,
    },
  ],
  exports: [AbuseProtectionService],
})
export class AbuseProtectionModule {}
