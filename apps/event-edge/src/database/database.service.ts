import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import pg, { type PoolClient, type QueryResultRow } from 'pg';

const { Pool } = pg;

export function edgeDatabaseConnectionTimeoutMs(
  environment: NodeJS.ProcessEnv = process.env,
): number {
  const raw = environment.EDGE_DATABASE_CONNECTION_TIMEOUT_MS?.trim();
  if (!raw) return 3_000;
  if (!/^\d+$/.test(raw)) {
    throw new Error('EDGE_DATABASE_CONNECTION_TIMEOUT_MS must be an integer');
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 500 || value > 15_000) {
    throw new Error('EDGE_DATABASE_CONNECTION_TIMEOUT_MS must be between 500 and 15000');
  }
  return value;
}

@Injectable()
export class EdgeDatabaseService implements OnModuleDestroy {
  private readonly pool = new Pool({
    connectionString:
      process.env.EDGE_DATABASE_URL ??
      process.env.DATABASE_URL ??
      'postgresql://event_commerce:localdev_only@localhost:5432/event_commerce_edge',
    connectionTimeoutMillis: edgeDatabaseConnectionTimeoutMs(),
  });

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<T[]> {
    const result = await this.pool.query<T>(text, [...values]);
    return result.rows;
  }

  async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
