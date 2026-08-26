import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { makeHealthResponse, type HealthResponse } from '@event-commerce/contracts';
import { DatabaseService } from '../database/database.service';
import {
  migrationLedgerIsCurrent,
  type MigrationLedgerEntry,
} from './migration-readiness';
import { runtimeReleaseCommit } from './release-identity';

@Controller('health')
export class HealthController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Get()
  async getHealth(): Promise<HealthResponse> {
    try {
      await this.database.query('SELECT 1');
      const migrationLedger = await this.database.query<MigrationLedgerEntry>(
        `SELECT filename, checksum_sha256 AS "checksumSha256"
         FROM schema_migrations
         ORDER BY filename`,
      );
      if (!migrationLedgerIsCurrent(migrationLedger)) {
        throw new Error('database migration ledger is not current');
      }
    } catch {
      throw new ServiceUnavailableException('service not ready');
    }
    return makeHealthResponse('cloud-api', new Date(), runtimeReleaseCommit());
  }
}
