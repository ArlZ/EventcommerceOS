import { Module } from '@nestjs/common';
import { EdgeDatabaseModule } from '../database/database.module';
import { OperatorEdgeGuard } from './operator-edge-auth.guard';
import { OperatorEdgeAuthService } from './operator-edge-auth.service';

@Module({
  imports: [EdgeDatabaseModule],
  providers: [OperatorEdgeAuthService, OperatorEdgeGuard],
  exports: [OperatorEdgeAuthService, OperatorEdgeGuard],
})
export class OperatorEdgeAuthModule {}
