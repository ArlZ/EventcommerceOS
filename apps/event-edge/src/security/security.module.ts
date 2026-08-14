import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { EdgeDatabaseModule } from '../database/database.module';
import { EdgeSecurityController } from './security.controller';
import { EdgeSecurityGuard } from './security.guard';
import { EdgeSecurityService } from './security.service';

@Module({
  imports: [EdgeDatabaseModule],
  controllers: [EdgeSecurityController],
  providers: [
    EdgeSecurityService,
    { provide: APP_GUARD, useClass: EdgeSecurityGuard },
  ],
  exports: [EdgeSecurityService],
})
export class EdgeSecurityModule {}
