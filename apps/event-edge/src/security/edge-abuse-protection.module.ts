import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { EdgeAbuseProtectionGuard } from './edge-abuse-protection.guard';

@Module({
  providers: [
    {
      provide: APP_GUARD,
      useClass: EdgeAbuseProtectionGuard,
    },
  ],
})
export class EdgeAbuseProtectionModule {}
