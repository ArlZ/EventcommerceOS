import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthController } from './auth.controller';
import { HumanAuthService } from './human-auth.service';

@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [AuthController],
  providers: [HumanAuthService],
  exports: [HumanAuthService],
})
export class AuthModule {}
