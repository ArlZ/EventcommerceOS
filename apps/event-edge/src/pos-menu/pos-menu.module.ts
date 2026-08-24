import { Module } from '@nestjs/common';
import { DeviceEdgeAuthModule } from '../security/device-edge-auth.module';
import { EdgeLocalAdminAuthService } from '../security/edge-local-admin-auth.service';
import { PosMenuController } from './pos-menu.controller';
import { PosMenuService } from './pos-menu.service';

@Module({
  imports: [DeviceEdgeAuthModule],
  controllers: [PosMenuController],
  providers: [EdgeLocalAdminAuthService, PosMenuService],
  exports: [PosMenuService],
})
export class PosMenuModule {}
