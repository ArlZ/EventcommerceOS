import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { EdgeAbuseConcurrencyInterceptor } from './edge-abuse-concurrency.interceptor';
import { EdgeAbuseProtectionGuard } from './edge-abuse-protection.guard';
import { EdgeAbuseProtectionService } from './edge-abuse-protection.service';

@Module({
  providers: [
    EdgeAbuseProtectionService,
    {
      provide: APP_GUARD,
      useClass: EdgeAbuseProtectionGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: EdgeAbuseConcurrencyInterceptor,
    },
  ],
})
export class EdgeAbuseProtectionModule {}
