import 'reflect-metadata';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { InventoryEdgeEvent } from '@event-commerce/contracts';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { InventoryService } from '../src/inventory/inventory.service';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration('Cloud inventory terminal conflict replay', () => {
  let database: DatabaseService;
  let inventory: InventoryService;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    database = moduleRef.get(DatabaseService);
    inventory = moduleRef.get(InventoryService);
  });

  beforeEach(async () => {
    await database.query(
      `TRUNCATE
         inventory_reconciliation_exceptions,
         inventory_count_projection,
         inventory_alert_projection,
         inventory_transfer_projection,
         inventory_ledger,
         inventory_edge_events
       CASCADE`,
    );
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('keeps a conflicting ledger idempotency reuse terminal on replay', async () => {
    const first: InventoryEdgeEvent = {
      id: 'edge-first-ledger',
      eventType: 'INVENTORY_LEDGER_POSTED',
      aggregateType: 'STOCK_LEDGER_ENTRY',
      aggregateId: 'ledger-first',
      payload: {
        id: 'ledger-first',
        eventId: 'event-cloud-conflict',
        inventoryLocationId: 'main',
        skuId: 'beer',
        movementType: 'RECEIPT',
        quantityDeltaBase: '100',
        sourceType: 'MANUAL',
        sourceId: 'receipt-first',
        occurredAt: '2026-08-14T08:00:00.000Z',
        idempotencyKey: 'shared-ledger-idempotency',
      },
    };
    const conflicting: InventoryEdgeEvent = {
      id: 'edge-conflicting-ledger',
      eventType: 'INVENTORY_LEDGER_POSTED',
      aggregateType: 'STOCK_LEDGER_ENTRY',
      aggregateId: 'ledger-conflicting',
      payload: {
        id: 'ledger-conflicting',
        eventId: 'event-cloud-conflict',
        inventoryLocationId: 'main',
        skuId: 'beer',
        movementType: 'RECEIPT',
        quantityDeltaBase: '200',
        sourceType: 'MANUAL',
        sourceId: 'receipt-conflicting',
        occurredAt: '2026-08-14T08:01:00.000Z',
        idempotencyKey: 'shared-ledger-idempotency',
      },
    };

    const accepted = await inventory.ingest({ edgeId: 'edge-a', events: [first] });
    const conflict = await inventory.ingest({ edgeId: 'edge-a', events: [conflicting] });
    const replay = await inventory.ingest({ edgeId: 'edge-a', events: [conflicting] });

    expect(accepted.acceptedIds).toEqual([first.id]);
    expect(conflict.conflictIds).toEqual([conflicting.id]);
    expect(replay.conflictIds).toEqual([conflicting.id]);
    expect(replay.duplicateIds).toEqual([]);

    const rows = await database.query<{ count: string; quantity: string }>(
      `SELECT count(*)::text AS count, SUM(quantity_delta)::text AS quantity
       FROM inventory_ledger`,
    );
    expect(rows[0]).toEqual({ count: '1', quantity: '100' });

    const exceptions = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM inventory_reconciliation_exceptions
       WHERE edge_event_id = $1 AND resolved_at IS NULL`,
      [conflicting.id],
    );
    expect(exceptions[0]!.count).toBe('1');
  });
});
