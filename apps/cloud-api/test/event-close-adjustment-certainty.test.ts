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
      grossSales: [{ currency: 'KES', amountMinor: '50000' }],
      discounts: [],
      comps: [],
      voids: [],
      refunds: [],
      netSales: [{ currency: 'KES', amountMinor: '50000' }],
    },
    paymentMethods: [
      {
        methodId: 'mpesa',
        currency: 'KES',
        succeededCount: 5,
        grossTenderMinor: '50000',
        refundMinor: '0',
        reversalMinor: '0',
        netTenderMinor: '50000',
        unresolvedAttemptCount: 0,
      },
    ],
    providerReconciliation: [
      {
        providerId: 'mpesa',
        currency: 'KES',
        succeededCount: 5,
        succeededValueMinor: '50000',
        pendingCount: 0,
        unknownCount: 0,
        failedCount: 0,
        unknownValueMinor: '0',
        adjustmentUnknownCount: 1,
        transactionReconciliationStatus: 'UNRESOLVED',
        settlementStatus: 'PROVIDER_SETTLEMENT_DATA_UNAVAILABLE',
      },
    ],
    cash: { summary: [], scopes: [] },
    inventoryVariances: [],
    unresolvedPayments: [],
    openTransfers: [],
    unresolvedCriticalAlerts: [],
    drilldowns: [],
    financialReconciliation: [
      {
        currency: 'KES',
        netSalesMinor: '50000',
        electronicNetTenderMinor: '50000',
        cashExpectedMinor: '0',
        accountedTenderMinor: '50000',
        salesToTenderVarianceMinor: '0',
        conclusive: true,
      },
    ],
  };
}

describe('event close adjustment certainty', () => {
  it('keeps financial reconciliation unresolved when a refund/reversal is unresolved', async () => {
    const database = {
      async query<T>(): Promise<T[]> {
        return [];
      },
    } as unknown as DatabaseService;
    const service = new EventCloseCashCountService(database);

    const enriched = await service.enrichLive('event-1', report());

    expect(enriched.financialReconciliation).toEqual([
      expect.objectContaining({
        currency: 'KES',
        conclusive: false,
      }),
    ]);
  });
});
