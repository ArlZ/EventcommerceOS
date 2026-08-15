import { Module } from '@nestjs/common';
import { EdgeDatabaseModule } from '../database/database.module';
import { DeviceEdgeAuthService } from './device-edge-auth.service';

@Module({
  imports: [EdgeDatabaseModule],
  providers: [DeviceEdgeAuthService],
  exports: [DeviceEdgeAuthService],
})
export class DeviceEdgeAuthModule {}
