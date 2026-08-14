import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseModule } from '../database/database.module';
import { SecurityController } from './security.controller';
import { CloudSecurityGuard } from './security.guard';
import { CloudSecurityService } from './security.service';

@Module({
  imports: [DatabaseModule],
  controllers: [SecurityController],
  providers: [
    CloudSecurityService,
    { provide: APP_GUARD, useClass: CloudSecurityGuard },
  ],
  exports: [CloudSecurityService],
})
export class SecurityModule {}
