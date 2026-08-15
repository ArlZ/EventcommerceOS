import { Global, Module } from '@nestjs/common';
import { AbuseProtectionGuard } from './abuse-protection.guard';
import { AbuseProtectionService } from './abuse-protection.service';

@Global()
@Module({
  providers: [AbuseProtectionService, AbuseProtectionGuard],
  exports: [AbuseProtectionService, AbuseProtectionGuard],
})
export class AbuseProtectionModule {}
