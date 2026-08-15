import { describe, expect, it } from 'vitest';
import type { EventCloseReport } from '@event-commerce/contracts';
import type { DatabaseService } from '../src/database/database.service';
import { EventCloseCashCountService } from '../src/event-close/event-close-cash-count.service';

function report(): EventCloseReport {
  return {
    event: {
      eventId: 'event-1',
      organisationId: 'org-1',
      name: 'Event',
      timezone: 'Africa/Nairobi',
      lifecycle: 'CLOSED',
    },
    close: {
      state: 'OPEN',
      lastActionAt: null,
      lastClosedAt: null,
      lastClosedRevision: null,
      lastClosedReportId: null,
      sourceVersionAtLastClose: null,
      sourceChangedSinceLastClose: false,
    },
    generatedAt: '2026-08-14T14:00:00.000Z',
    sourceVersionToken: 'source-1',
    sales: {
      grossSales: [],
      discounts: [],
      comps: [],
      voids: [],
      refunds: [],
      netSales: [],
    },
    paymentMethods: [
      {
        methodId: 'cash',
        currency: 'KES',
        succeededCount: 0,
        grossTenderMinor: '25000',
        refundMinor: '0',
        reversalMinor: '0',
        netTenderMinor: '25000',
        unresolvedAttemptCount: 0,
      },
      {
        methodId: 'mpesa',
        currency: 'KES',
        succeededCount: 4,
        grossTenderMinor: '40000',
        refundMinor: '0',
        reversalMinor: '0',
        netTenderMinor: '40000',
        unresolvedAttemptCount: 0,
      },
    ],
    providerReconciliation: [],
    cash: { summary: [], scopes: [] },
    inventoryVariances: [],
    unresolvedPayments: [],
    openTransfers: [],
    unresolvedCriticalAlerts: [],
    drilldowns: [],
    financialReconciliation: [],
  };
}

describe('event close cash count enrichment', () => {
  it('counts cash tenders from cash-closed orders without changing provider counts', async () => {
    let queries = 0;
    const database = {
      async query<T>(): Promise<T[]> {
        queries += 1;
        return [{ currency: 'KES', transaction_count: '3' }] as T[];
      },
    } as unknown as DatabaseService;
    const service = new EventCloseCashCountService(database);

    const enriched = await service.enrichLive('event-1', report());

    expect(queries).toBe(1);
    expect(enriched.paymentMethods).toEqual([
      expect.objectContaining({ methodId: 'cash', succeededCount: 3 }),
      expect.objectContaining({ methodId: 'mpesa', succeededCount: 4 }),
    ]);
  });
});
