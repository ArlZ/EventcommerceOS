import { Injectable } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import pg, { type PoolClient } from 'pg';

const { Pool } = pg;

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      'postgresql://event_commerce:localdev_only@localhost:5432/event_commerce_cloud',
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
