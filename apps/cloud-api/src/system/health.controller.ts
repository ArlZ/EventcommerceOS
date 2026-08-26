import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { makeHealthResponse, type HealthResponse } from '@event-commerce/contracts';
import {
  SupabaseAuthTransport,
  type SupabaseAuthDependencyProbe,
} from '../auth/supabase-auth.transport';
import { DatabaseService } from '../database/database.service';
import { migrationLedgerIsCurrent, type MigrationLedgerEntry } from './migration-readiness';
import { runtimeReleaseCommit } from './release-identity';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(SupabaseAuthTransport) private readonly supabaseAuth: SupabaseAuthTransport,
  ) {}

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

  @Get('operator-auth')
  async getOperatorAuthHealth(): Promise<SupabaseAuthDependencyProbe> {
    const probe = await this.supabaseAuth.dependencyProbe();
    if (probe.status !== 'ok') {
      throw new ServiceUnavailableException(probe);
    }
    return probe;
  }
}
