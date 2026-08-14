import { describe, expect, it } from 'vitest';
import type { DatabaseService } from '../src/database/database.service';
import type { PaymentRailService } from '../src/payments/payment-rail.service';
import { CommandCentreService } from '../src/command-centre/command-centre.service';

const organisationId = '11111111-1111-4111-8111-111111111111';
const eventId = '22222222-2222-4222-8222-222222222222';
const actorId = '33333333-3333-4333-8333-333333333333';

describe('command centre aggregation shape', () => {
  it('uses a fixed query count rather than per-register or per-product reads', async () => {
    const calls: string[] = [];
    const database = {
      async query<T>(sql: string): Promise<T[]> {
        calls.push(sql);
        if (sql.includes('FROM events WHERE id')) {
          return [
            {
              id: eventId,
              organisation_id: organisationId,
              name: 'High volume event',
              timezone: 'Africa/Nairobi',
              lifecycle: 'ACTIVE',
              starts_at: '2026-08-14T12:00:00.000Z',
              ends_at: '2026-08-14T22:00:00.000Z',
            },
          ] as T[];
        }
        if (sql.includes('marks AS')) {
          return [{ latest_source_at: null, version_token: 'empty' }] as T[];
        }
        return [];
      },
    } as unknown as DatabaseService;
    const rails = { availability: () => [] } as unknown as PaymentRailService;
    const service = new CommandCentreService(database, rails);

    const snapshot = await service.snapshot(
      { actorId, organisationId, role: 'ADMIN' },
      eventId,
    );

    expect(calls).toHaveLength(10);
    expect(snapshot.sales.transactionCount).toBe(0);
    expect(snapshot.salesLocations).toEqual([]);
    expect(snapshot.topProducts).toEqual([]);
  });
});
