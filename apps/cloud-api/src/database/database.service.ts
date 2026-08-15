import { Injectable } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import pg, { type PoolClient } from 'pg';

const { Pool } = pg;
const LOCAL_DATABASE_URL =
  'postgresql://event_commerce:localdev_only@localhost:5432/event_commerce_cloud';

export function databaseConnectionString(environment: NodeJS.ProcessEnv = process.env): string {
  const configured = environment.DATABASE_URL?.trim();
  if (configured) return configured;
  if (environment.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL is required in production');
  }
  return LOCAL_DATABASE_URL;
}

export function databaseConnectionTimeoutMs(
  environment: NodeJS.ProcessEnv = process.env,
): number {
  const raw = environment.DATABASE_CONNECTION_TIMEOUT_MS?.trim();
  if (!raw) return 5_000;
  if (!/^\d+$/.test(raw)) {
    throw new Error('DATABASE_CONNECTION_TIMEOUT_MS must be an integer');
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1_000 || value > 30_000) {
    throw new Error('DATABASE_CONNECTION_TIMEOUT_MS must be between 1000 and 30000');
  }
  return value;
}

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool = new Pool({
    connectionString: databaseConnectionString(),
    connectionTimeoutMillis: databaseConnectionTimeoutMs(),
  });

  async query<T = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<T[]> {
    const result = await this.pool.query(text, [...values]);
    return result.rows as T[];
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
