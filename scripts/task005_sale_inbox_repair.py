from pathlib import Path

root = Path('.')

def load(path: str) -> str:
    return (root / path).read_text()

def save(path: str, text: str) -> None:
    (root / path).write_text(text)

save(
    'apps/event-edge/migrations/0007_inventory_sale_inbox.sql',
    """CREATE TABLE IF NOT EXISTS edge_inventory_sale_inbox (
  source_event_instance_id text PRIMARY KEY
    REFERENCES edge_processed_device_events(event_instance_id) ON DELETE CASCADE,
  envelope jsonb NOT NULL,
  received_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  outcome text CHECK (outcome IS NULL OR outcome IN ('APPLIED', 'EXCEPTION')),
  last_error text
);

CREATE INDEX IF NOT EXISTS edge_inventory_sale_inbox_pending_idx
  ON edge_inventory_sale_inbox(next_attempt_at, received_at)
  WHERE processed_at IS NULL;

CREATE OR REPLACE FUNCTION edge_queue_inventory_sale()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.event_type = 'ORDER_CLOSED_CASH' THEN
    INSERT INTO edge_inventory_sale_inbox(
      source_event_instance_id, envelope, received_at, next_attempt_at
    ) VALUES (
      NEW.event_instance_id, NEW.envelope, NEW.received_at, NEW.received_at
    ) ON CONFLICT (source_event_instance_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS edge_inventory_sale_inbox_trigger ON edge_processed_device_events;
CREATE TRIGGER edge_inventory_sale_inbox_trigger
AFTER INSERT ON edge_processed_device_events
FOR EACH ROW EXECUTE FUNCTION edge_queue_inventory_sale();

INSERT INTO edge_inventory_sale_inbox(
  source_event_instance_id, envelope, received_at, next_attempt_at
)
SELECT event_instance_id, envelope, received_at, received_at
FROM edge_processed_device_events
WHERE event_type = 'ORDER_CLOSED_CASH'
ON CONFLICT (source_event_instance_id) DO NOTHING;
""",
)

# Sale consumer marks durable inbox outcome in the same transaction as ledger/exception effects.
path = 'apps/event-edge/src/inventory/inventory-sale-consumer.service.ts'
text = load(path)

# Add mark before every exception return.
replacements = [
    (
        """        await this.exception(client, 'INVALID_SALE_INVENTORY_PAYLOAD', event, null, null, {
          payload: event.payload,
        });
        return null;
""",
        """        await this.exception(client, 'INVALID_SALE_INVENTORY_PAYLOAD', event, null, null, {
          payload: event.payload,
        });
        await this.markProcessed(client, event.eventInstanceId, 'EXCEPTION');
        return null;
""",
    ),
    (
        """        );
        return parsed.eventId;
      }
      const inventoryLocationId = mapping.rows[0]!.inventory_location_id;
""",
        """        );
        await this.markProcessed(client, event.eventInstanceId, 'EXCEPTION');
        return parsed.eventId;
      }
      const inventoryLocationId = mapping.rows[0]!.inventory_location_id;
""",
    ),
    (
        """              { skuId: line.skuId },
            );
            return parsed.eventId;
""",
        """              { skuId: line.skuId },
            );
            await this.markProcessed(client, event.eventInstanceId, 'EXCEPTION');
            return parsed.eventId;
""",
    ),
    (
        """              { soldSkuId: line.skuId, componentSkuId: component.component_sku_id },
            );
            return parsed.eventId;
""",
        """              { soldSkuId: line.skuId, componentSkuId: component.component_sku_id },
            );
            await this.markProcessed(client, event.eventInstanceId, 'EXCEPTION');
            return parsed.eventId;
""",
    ),
]
for old, new in replacements:
    if old not in text:
        raise SystemExit(f'sale consumer exception anchor missing: {old[:60]!r}')
    text = text.replace(old, new, 1)

old = """      for (const movement of orderedMovements) {
        await this.ledger.insert(client, {
          eventId: parsed.eventId,
          inventoryLocationId,
          skuId: movement.skuId,
          movementType: movement.type,
          quantityDeltaBase: -movement.quantity,
          sourceType: 'ORDER',
          sourceId: parsed.orderId,
          sourceEventInstanceId: event.eventInstanceId,
          deviceId: event.deviceId,
          reason: 'sale-driven inventory consumption',
          occurredAt: event.occurredAt,
          idempotencyKey: `sale:${event.eventInstanceId}:${movement.type}:${movement.skuId}`,
        });
      }
      return parsed.eventId;
"""
new = """      for (const movement of orderedMovements) {
        await this.ledger.insert(client, {
          eventId: parsed.eventId,
          inventoryLocationId,
          skuId: movement.skuId,
          movementType: movement.type,
          quantityDeltaBase: -movement.quantity,
          sourceType: 'ORDER',
          sourceId: parsed.orderId,
          sourceEventInstanceId: event.eventInstanceId,
          deviceId: event.deviceId,
          reason: 'sale-driven inventory consumption',
          occurredAt: event.occurredAt,
          idempotencyKey: `sale:${event.eventInstanceId}:${movement.type}:${movement.skuId}`,
        });
      }
      await this.markProcessed(client, event.eventInstanceId, 'APPLIED');
      return parsed.eventId;
"""
if old not in text:
    raise SystemExit('sale consumer success anchor missing')
text = text.replace(old, new, 1)

anchor = """  private async exception(
"""
helper = """  private async markProcessed(
    client: PoolClient,
    eventInstanceId: string,
    outcome: 'APPLIED' | 'EXCEPTION',
  ): Promise<void> {
    await client.query(
      `UPDATE edge_inventory_sale_inbox
       SET processed_at = clock_timestamp(), outcome = $2, last_error = NULL
       WHERE source_event_instance_id = $1`,
      [eventInstanceId, outcome],
    );
  }

  private async exception(
"""
if anchor not in text:
    raise SystemExit('sale consumer markProcessed insertion anchor missing')
text = text.replace(anchor, helper, 1)
save(path, text)

# Operations loop consumes only indexed pending inbox rows; poison events back off independently.
path = 'apps/event-edge/src/inventory/inventory-operations-loop.service.ts'
text = load(path)
text = text.replace(
    "import type { QueryResultRow } from 'pg';\n",
    "import type { QueryResultRow } from 'pg';\nimport type { SyncEventEnvelope } from '@event-commerce/contracts';\n",
    1,
)
text = text.replace(
    "import { InventoryNotificationService } from './inventory-notification.service';\n",
    "import { InventoryNotificationService } from './inventory-notification.service';\n"
    "import { InventorySaleConsumerService } from './inventory-sale-consumer.service';\n",
    1,
)
text = text.replace(
    "interface EventIdRow extends QueryResultRow {\n  event_id: string;\n}\n",
    "interface EventIdRow extends QueryResultRow {\n  event_id: string;\n}\n\n"
    "interface PendingSaleRow extends QueryResultRow {\n"
    "  source_event_instance_id: string;\n"
    "  envelope: SyncEventEnvelope;\n"
    "}\n",
    1,
)
text = text.replace(
    """    @Inject(InventoryNotificationService)
    private readonly notifications: InventoryNotificationService,
  ) {}
""",
    """    @Inject(InventoryNotificationService)
    private readonly notifications: InventoryNotificationService,
    @Inject(InventorySaleConsumerService)
    private readonly sales: InventorySaleConsumerService,
  ) {}
""",
    1,
)
text = text.replace(
    """  async runOnce(now = new Date()): Promise<{ eventsEvaluated: number }> {
    const rows = await this.database.query<EventIdRow>(
""",
    """  async runOnce(
    now = new Date(),
  ): Promise<{ eventsEvaluated: number; salesReconciled: number }> {
    const salesReconciled = await this.reconcilePendingSales(now);
    const rows = await this.database.query<EventIdRow>(
""",
    1,
)
text = text.replace(
    """    return { eventsEvaluated: rows.length };
  }

  private async tick(): Promise<void> {
""",
    """    return { eventsEvaluated: rows.length, salesReconciled };
  }

  private async reconcilePendingSales(now: Date): Promise<number> {
    const pending = await this.database.query<PendingSaleRow>(
      `SELECT source_event_instance_id, envelope
       FROM edge_inventory_sale_inbox
       WHERE processed_at IS NULL AND next_attempt_at <= $1
       ORDER BY next_attempt_at, received_at
       LIMIT 100`,
      [now.toISOString()],
    );

    let reconciled = 0;
    for (const row of pending) {
      try {
        await this.sales.consume([row.envelope]);
        reconciled += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'inventory sale reconciliation failed';
        await this.database.query(
          `UPDATE edge_inventory_sale_inbox
           SET attempts = attempts + 1,
               next_attempt_at = $2::timestamptz + make_interval(secs => LEAST(60, (2 ^ LEAST(attempts + 1, 6))::integer)),
               last_error = $3
           WHERE source_event_instance_id = $1 AND processed_at IS NULL`,
          [row.source_event_instance_id, now.toISOString(), message],
        );
      }
    }
    return reconciled;
  }

  private async tick(): Promise<void> {
""",
    1,
)
save(path, text)

# Fixture resets inbox and inventory test device persisted sales so tests stay isolated.
path = 'apps/event-edge/test/inventory-fixture.ts'
text = load(path)
text = text.replace(
    """    `TRUNCATE
       edge_inventory_notification_outbox,
""",
    """    `TRUNCATE
       edge_inventory_sale_inbox,
       edge_inventory_notification_outbox,
""",
    1,
)
anchor = """  );
}

export async function installInventoryFixture(
"""
replacement = """  );
  await database.query(
    `DELETE FROM edge_processed_device_events
     WHERE device_id = 'device-inventory-test' AND event_type = 'ORDER_CLOSED_CASH'`,
  );
}

export async function installInventoryFixture(
"""
if anchor not in text:
    raise SystemExit('fixture reset anchor missing')
text = text.replace(anchor, replacement, 1)
save(path, text)

# Crash-window integration: sale persisted, direct consumer never called, periodic inbox heals exactly once.
path = 'apps/event-edge/test/inventory-operations-loop.integration.test.ts'
text = load(path)
insert = """
  it('recovers a persisted sale after a crash between sync durability and inventory consumption', async () => {
    await receipt(ledger, mainLocationId, beerSkuId, 100n, 'crash-window-main');
    const sale = closedSale({
      eventInstanceId: 'crash-window-sale-301',
      occurredAt: '2026-08-14T08:00:00.000Z',
      lines: [{ skuId: beerSkuId, quantity: 2 }],
    });

    await database.query(
      `INSERT INTO edge_processed_device_events(
         event_instance_id, event_id, event_type, aggregate_type, aggregate_id,
         event_version, device_id, sequence, occurred_at, idempotency_key, payload, envelope
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb)`,
      [
        sale.eventInstanceId,
        sale.eventId,
        sale.eventType,
        sale.aggregateType,
        sale.aggregateId,
        sale.eventVersion,
        sale.deviceId,
        sale.sequence,
        sale.occurredAt,
        sale.idempotencyKey,
        JSON.stringify(sale.payload),
        JSON.stringify(sale),
      ],
    );

    const before = await database.query<{ processed_at: Date | null }>(
      `SELECT processed_at FROM edge_inventory_sale_inbox
       WHERE source_event_instance_id = $1`,
      [sale.eventInstanceId],
    );
    expect(before[0]!.processed_at).toBeNull();

    const first = await loop.runOnce(new Date('2026-08-14T08:00:10.000Z'));
    const second = await loop.runOnce(new Date('2026-08-14T08:00:20.000Z'));
    expect(first.salesReconciled).toBe(1);
    expect(second.salesReconciled).toBe(0);

    const movement = await database.query<{ count: string; quantity: string }>(
      `SELECT count(*)::text AS count, SUM(quantity_delta)::text AS quantity
       FROM edge_inventory_ledger
       WHERE source_event_instance_id = $1 AND movement_type = 'SALE'`,
      [sale.eventInstanceId],
    );
    const inbox = await database.query<{ processed_at: Date | null; outcome: string | null }>(
      `SELECT processed_at, outcome FROM edge_inventory_sale_inbox
       WHERE source_event_instance_id = $1`,
      [sale.eventInstanceId],
    );
    expect(movement[0]).toEqual({ count: '1', quantity: '-2' });
    expect(inbox[0]!.processed_at).not.toBeNull();
    expect(inbox[0]!.outcome).toBe('APPLIED');
  });
"""
if "recovers a persisted sale after a crash" in text:
    raise SystemExit('crash-window test already exists unexpectedly')
pos = text.rfind('\n});')
if pos == -1:
    raise SystemExit('operations loop test closing anchor missing')
text = text[:pos] + insert + text[pos:]
save(path, text)

for temporary in [
    'scripts/task005_sale_inbox_repair.py',
    '.github/workflows/task005-sale-inbox-repair.yml',
]:
    p = root / temporary
    if p.exists():
        p.unlink()
