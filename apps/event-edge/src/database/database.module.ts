import { Global, Module } from '@nestjs/common';
import { EdgeDatabaseService } from './database.service';

@Global()
@Module({
  providers: [EdgeDatabaseService],
  exports: [EdgeDatabaseService],
})
export class EdgeDatabaseModule {}
