import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { InventoryEdgeEvent } from '@event-commerce/contracts';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { InventoryService } from '../src/inventory/inventory.service';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration('Cloud inventory consolidation', () => {
  let database: DatabaseService;
  let inventory: InventoryService;
  let moduleRef: Awaited<ReturnType<typeof Test.createTestingModule>> extends never ? never : any;

  beforeAll(async () => {
    const builder = Test.createTestingModule({ imports: [AppModule] });
    moduleRef = await builder.compile();
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

  it('treats semantic JSONB replay as duplicate even when object key order changes', async () => {
    const payloadA = {
      id: 'ledger-cloud-001',
      eventId: 'cloud-event',
      inventoryLocationId: 'main',
      skuId: 'beer',
      movementType: 'SALE',
      quantityDeltaBase: '-2',
      sourceType: 'ORDER',
      sourceId: 'order-1',
      occurredAt: '2026-08-14T08:00:00.000Z',
      idempotencyKey: 'cloud-ledger-idem-001',
    };
    const payloadB = {
      idempotencyKey: 'cloud-ledger-idem-001',
      occurredAt: '2026-08-14T08:00:00.000Z',
      sourceId: 'order-1',
      sourceType: 'ORDER',
      quantityDeltaBase: '-2',
      movementType: 'SALE',
      skuId: 'beer',
      inventoryLocationId: 'main',
      eventId: 'cloud-event',
      id: 'ledger-cloud-001',
    };
    const eventA: InventoryEdgeEvent = {
      id: 'edge-ledger-event-001',
      eventType: 'INVENTORY_LEDGER_POSTED',
      aggregateType: 'STOCK_LEDGER_ENTRY',
      aggregateId: 'ledger-cloud-001',
      payload: payloadA,
    };
    const eventB: InventoryEdgeEvent = { ...eventA, payload: payloadB };

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const result = await inventory.ingest({
        edgeId: 'edge-a',
        events: [attempt % 2 === 0 ? eventA : eventB],
      });
      if (attempt === 0) expect(result.acceptedIds).toEqual([eventA.id]);
      else expect(result.duplicateIds).toEqual([eventA.id]);
    }

    const ledgerRows = await database.query<{ count: string; quantity: string }>(
      `SELECT count(*)::text AS count, SUM(quantity_delta)::text AS quantity
       FROM inventory_ledger WHERE id = 'ledger-cloud-001'`,
    );
    expect(ledgerRows[0]).toEqual({ count: '1', quantity: '-2' });
  });

  it('records an Edge event ID reuse conflict without a second business effect', async () => {
    const base: InventoryEdgeEvent = {
      id: 'edge-reuse-001',
      eventType: 'INVENTORY_LEDGER_POSTED',
      aggregateType: 'STOCK_LEDGER_ENTRY',
      aggregateId: 'ledger-reuse-001',
      payload: {
        id: 'ledger-reuse-001',
        eventId: 'cloud-event',
        inventoryLocationId: 'main',
        skuId: 'beer',
        movementType: 'RECEIPT',
        quantityDeltaBase: '10',
        sourceType: 'MANUAL',
        sourceId: 'receipt-1',
        occurredAt: '2026-08-14T08:00:00.000Z',
        idempotencyKey: 'reuse-idem-1',
      },
    };
    await inventory.ingest({ edgeId: 'edge-a', events: [base] });
    const conflict = await inventory.ingest({
      edgeId: 'edge-a',
      events: [
        {
          ...base,
          payload: { ...base.payload, quantityDeltaBase: '11' },
        },
      ],
    });

    expect(conflict.conflictIds).toEqual([base.id]);
    const ledgerRows = await database.query<{ count: string; quantity: string }>(
      `SELECT count(*)::text AS count, SUM(quantity_delta)::text AS quantity
       FROM inventory_ledger WHERE id = 'ledger-reuse-001'`,
    );
    expect(ledgerRows[0]).toEqual({ count: '1', quantity: '10' });
  });

  it('does not let a late older alert event regress newer operational state', async () => {
    const alertPayload = {
      id: 'alert-cloud-001',
      alertType: 'STOCKOUT_RISK',
      severity: 'URGENT',
      eventId: 'cloud-event',
      inventoryLocationId: 'main',
      skuId: 'beer',
      availableQuantityBase: '10',
      minutesOfCover: 4.5,
      suggestedSourceLocationId: 'warehouse',
      suggestedTransferQuantityBase: '50',
      responsibleActorId: 'controller',
      assignedActorId: 'runner',
      openedAt: '2026-08-14T08:00:00.000Z',
      escalateAt: '2026-08-14T08:15:00.000Z',
    };
    const newer: InventoryEdgeEvent = {
      id: 'alert-edge-newer',
      eventType: 'INVENTORY_ALERT_UPSERTED',
      aggregateType: 'INVENTORY_ALERT',
      aggregateId: 'alert-cloud-001',
      payload: {
        ...alertPayload,
        state: 'ASSIGNED',
        sourceUpdatedAt: '2026-08-14T08:10:00.000Z',
      },
    };
    const older: InventoryEdgeEvent = {
      ...newer,
      id: 'alert-edge-older',
      payload: {
        ...alertPayload,
        state: 'OPEN',
        assignedActorId: null,
        sourceUpdatedAt: '2026-08-14T08:05:00.000Z',
      },
    };

    await inventory.ingest({ edgeId: 'edge-a', events: [newer] });
    await inventory.ingest({ edgeId: 'edge-a', events: [older] });

    const rows = await database.query<{
      state: string;
      assigned_actor_id: string | null;
      source_updated_at: Date;
    }>(
      `SELECT state, assigned_actor_id, source_updated_at
       FROM inventory_alert_projection WHERE id = 'alert-cloud-001'`,
    );
    expect(rows[0]!.state).toBe('ASSIGNED');
    expect(rows[0]!.assigned_actor_id).toBe('runner');
    expect(rows[0]!.source_updated_at.toISOString()).toBe('2026-08-14T08:10:00.000Z');
  });
});
