import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AbuseConcurrencyInterceptor } from './abuse-concurrency.interceptor';
import { AbuseProtectionGuard } from './abuse-protection.guard';
import { AbuseProtectionService } from './abuse-protection.service';

@Global()
@Module({
  providers: [
    AbuseProtectionService,
    AbuseProtectionGuard,
    {
      provide: APP_INTERCEPTOR,
      useClass: AbuseConcurrencyInterceptor,
    },
  ],
  exports: [AbuseProtectionService, AbuseProtectionGuard],
})
export class AbuseProtectionModule {}
