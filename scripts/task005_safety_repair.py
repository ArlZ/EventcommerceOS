from pathlib import Path
import re

root = Path('.')

def load(path: str) -> str:
    return (root / path).read_text()

def save(path: str, text: str) -> None:
    (root / path).write_text(text)

# ---- Inventory ledger safety ----
path = 'apps/event-edge/src/inventory/inventory-ledger.service.ts'
text = load(path)

anchor = "interface ProjectionDbRow extends QueryResultRow {\n  event_id: string;\n  inventory_location_id: string;\n  sku_id: string;\n  on_hand: string;\n  inbound: string;\n}\n\n@Injectable()"
replacement = "interface ProjectionDbRow extends QueryResultRow {\n  event_id: string;\n  inventory_location_id: string;\n  sku_id: string;\n  on_hand: string;\n  inbound: string;\n}\n\nconst DEDICATED_WORKFLOW_MOVEMENTS = new Set<InventoryMovementType>([\n  'SALE',\n  'RECIPE_CONSUMPTION',\n  'TRANSFER_OUT',\n  'TRANSFER_IN',\n  'COUNT_ADJUSTMENT',\n]);\n\n@Injectable()"
if anchor not in text:
    raise SystemExit('ledger constant anchor missing')
text = text.replace(anchor, replacement, 1)

post_manual_pattern = re.compile(
    r"  async postManual\(input: ManualMovementInput\): Promise<LedgerRow> \{.*?\n  \}\n\n  async lockStock",
    re.S,
)
post_manual_replacement = """  async postManual(input: ManualMovementInput): Promise<LedgerRow> {
    return this.database.transaction(async (client) => {
      await this.authorization.require(client, input.eventId, input.actorId, 'INVENTORY_MOVE');
      if (DEDICATED_WORKFLOW_MOVEMENTS.has(input.movementType)) {
        throw new ConflictException('movement type requires a dedicated inventory workflow');
      }

      const movement: LedgerInput = {
        id: input.id,
        eventId: input.eventId,
        inventoryLocationId: input.inventoryLocationId,
        skuId: input.skuId,
        movementType: input.movementType,
        quantityDeltaBase: BigInt(input.quantityDeltaBase),
        sourceType: 'MANUAL',
        sourceId: input.id,
        actorId: input.actorId,
        reason: input.reason,
        occurredAt: input.occurredAt,
        idempotencyKey: input.idempotencyKey,
        reversalOfLedgerId: input.reversalOfLedgerId,
      };

      if (input.movementType === 'REVERSAL') {
        if (!input.reversalOfLedgerId) {
          throw new ConflictException('reversal requires a reversal target');
        }
        await this.lockStock(client, input.eventId, input.inventoryLocationId, input.skuId);
        const targetResult = await client.query<LedgerRow>(
          'SELECT * FROM edge_inventory_ledger WHERE id = $1 FOR UPDATE',
          [input.reversalOfLedgerId],
        );
        const target = targetResult.rows[0];
        if (!target) throw new ConflictException('reversal target does not exist');
        if (
          target.event_id !== input.eventId ||
          target.inventory_location_id !== input.inventoryLocationId ||
          target.sku_id !== input.skuId
        ) {
          throw new ConflictException('reversal target must match event, location and SKU');
        }
        if (target.movement_type === 'REVERSAL') {
          throw new ConflictException('a reversal cannot reverse another reversal');
        }
        if (movement.quantityDeltaBase !== -BigInt(target.quantity_delta)) {
          throw new ConflictException('reversal must exactly negate the target movement');
        }

        const previous = await client.query<LedgerRow>(
          'SELECT * FROM edge_inventory_ledger WHERE reversal_of_ledger_id = $1 LIMIT 1',
          [target.id],
        );
        if (previous.rowCount === 1) {
          const existing = previous.rows[0]!;
          if (this.sameMovement(existing, movement)) return existing;
          throw new ConflictException('reversal target was reused');
        }
      } else if (input.reversalOfLedgerId) {
        throw new ConflictException('only a REVERSAL movement may reference a reversal target');
      }

      return this.insert(client, movement);
    });
  }

  async lockStock"""
text, count = post_manual_pattern.subn(post_manual_replacement, text, count=1)
if count != 1:
    raise SystemExit(f'postManual replacement count={count}')

old = "const lockKey = `${eventId}\\u0000${inventoryLocationId}\\u0000${skuId}`;"
new = "const lockKey = JSON.stringify([eventId, inventoryLocationId, skuId]);"
if old not in text:
    raise SystemExit('ledger lock key anchor missing')
text = text.replace(old, new, 1)

old = """       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING *`,
"""
new = """       ON CONFLICT DO NOTHING
       RETURNING *`,
"""
if old not in text:
    raise SystemExit('ledger insert conflict anchor missing')
text = text.replace(old, new, 1)

old = """    const existing = await client.query<LedgerRow>(
      'SELECT * FROM edge_inventory_ledger WHERE idempotency_key = $1',
      [input.idempotencyKey],
    );
"""
new = """    const existing = await client.query<LedgerRow>(
      `SELECT * FROM edge_inventory_ledger
       WHERE idempotency_key = $1 OR id = $2
       ORDER BY (idempotency_key = $1) DESC
       LIMIT 1`,
      [input.idempotencyKey, id],
    );
"""
if old not in text:
    raise SystemExit('ledger collision lookup anchor missing')
text = text.replace(old, new, 1)

old = """    return (
      row.event_id === input.eventId &&
"""
new = """    return (
      (input.id === undefined || row.id === input.id) &&
      row.event_id === input.eventId &&
"""
if old not in text:
    raise SystemExit('ledger sameMovement start anchor missing')
text = text.replace(old, new, 1)

old = """      row.reason === (input.reason ?? null) &&
      row.reversal_of_ledger_id === (input.reversalOfLedgerId ?? null)
"""
new = """      row.reason === (input.reason ?? null) &&
      row.occurred_at.toISOString() === new Date(input.occurredAt).toISOString() &&
      row.reversal_of_ledger_id === (input.reversalOfLedgerId ?? null)
"""
if old not in text:
    raise SystemExit('ledger sameMovement timestamp anchor missing')
text = text.replace(old, new, 1)
save(path, text)

# ---- Transfer create / receipt replay safety ----
path = 'apps/event-edge/src/inventory/inventory-transfer.service.ts'
text = load(path)
text = text.replace(
    "  request_reason: string;\n  updated_at: Date;",
    "  request_reason: string;\n  requested_at: Date;\n  updated_at: Date;",
    1,
)
text = text.replace(
    "interface ReceiptRow extends QueryResultRow {\n  same_payload: boolean;\n}",
    "interface ReceiptRow extends QueryResultRow {\n  transfer_id: string;\n  actor_id: string;\n  received_at: Date;\n  same_payload: boolean;\n}",
    1,
)

create_pattern = re.compile(
    r"  async create\(input: CreateTransferInput\): Promise<TransferRow> \{.*?\n  \}\n\n  async assign",
    re.S,
)
create_replacement = """  async create(input: CreateTransferInput): Promise<TransferRow> {
    return this.database.transaction(async (client) => {
      await this.authorization.require(client, input.eventId, input.actorId, 'TRANSFER_MANAGE');
      if (new Set(input.lines.map((line) => line.skuId)).size !== input.lines.length) {
        throw new ConflictException('transfer lines must not repeat a SKU');
      }

      const lockKeys = [
        `stock-transfer-id:${input.id}`,
        `stock-transfer-idempotency:${input.idempotencyKey}`,
      ].sort();
      for (const lockKey of lockKeys) {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [lockKey]);
      }

      const duplicate = await client.query<TransferDbRow>(
        'SELECT * FROM edge_stock_transfers WHERE idempotency_key = $1',
        [input.idempotencyKey],
      );
      if (duplicate.rowCount === 1) {
        const existing = duplicate.rows[0]!;
        if (!(await this.sameCreate(client, existing, input))) {
          throw new ConflictException('transfer idempotency key was reused with different content');
        }
        return this.map(existing);
      }

      const idReuse = await client.query<TransferDbRow>(
        'SELECT * FROM edge_stock_transfers WHERE id = $1',
        [input.id],
      );
      if (idReuse.rowCount === 1) {
        throw new ConflictException('transfer ID was reused with different content');
      }

      await client.query(
        `INSERT INTO edge_stock_transfers(
           id, event_id, source_location_id, destination_location_id, state,
           requested_by_actor_id, request_reason, requested_at, idempotency_key
         ) VALUES ($1,$2,$3,$4,'REQUESTED',$5,$6,$7,$8)`,
        [
          input.id,
          input.eventId,
          input.sourceLocationId,
          input.destinationLocationId,
          input.actorId,
          input.reason,
          input.requestedAt,
          input.idempotencyKey,
        ],
      );
      for (const line of [...input.lines].sort((a, b) => a.skuId.localeCompare(b.skuId))) {
        await client.query(
          `INSERT INTO edge_stock_transfer_lines(transfer_id, sku_id, requested_quantity)
           VALUES ($1,$2,$3)`,
          [input.id, line.skuId, line.requestedQuantityBase],
        );
      }
      await this.history(
        client,
        input.id,
        null,
        'REQUESTED',
        input.actorId,
        input.reason,
        input.requestedAt,
      );
      const row = await this.transfer(client, input.id, true);
      await this.queueCloud(client, row);
      return this.map(row);
    });
  }

  async assign"""
text, count = create_pattern.subn(create_replacement, text, count=1)
if count != 1:
    raise SystemExit(f'transfer create replacement count={count}')

old = """      const supplied = new Map(
        input.quantities.map((line) => [line.skuId, BigInt(line.quantityBase)]),
      );
      if (requested.size !== supplied.size)
"""
new = """      const supplied = new Map(
        input.quantities.map((line) => [line.skuId, BigInt(line.quantityBase)]),
      );
      if (supplied.size !== input.quantities.length) {
        throw new ConflictException('dispatch quantities must not repeat a SKU');
      }
      if (requested.size !== supplied.size)
"""
if old not in text:
    raise SystemExit('dispatch duplicate guard anchor missing')
text = text.replace(old, new, 1)

old = """      const orderedReceipts = [...input.quantities].sort((a, b) => a.skuId.localeCompare(b.skuId));
      const canonicalPayload = JSON.stringify(
"""
new = """      const orderedReceipts = [...input.quantities].sort((a, b) => a.skuId.localeCompare(b.skuId));
      if (new Set(orderedReceipts.map((line) => line.skuId)).size !== orderedReceipts.length) {
        throw new ConflictException('receipt quantities must not repeat a SKU');
      }
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `stock-transfer-receipt-idempotency:${input.idempotencyKey}`,
      ]);
      const canonicalPayload = JSON.stringify(
"""
if old not in text:
    raise SystemExit('receipt guard anchor missing')
text = text.replace(old, new, 1)

old = """      const existingReceipt = await client.query<ReceiptRow>(
        `SELECT (payload = $2::jsonb) AS same_payload
         FROM edge_stock_transfer_receipts WHERE idempotency_key = $1`,
        [input.idempotencyKey, canonicalPayload],
      );
      if (existingReceipt.rowCount === 1) {
        if (!existingReceipt.rows[0]!.same_payload) {
"""
new = """      const existingReceipt = await client.query<ReceiptRow>(
        `SELECT transfer_id, actor_id, received_at, (payload = $2::jsonb) AS same_payload
         FROM edge_stock_transfer_receipts WHERE idempotency_key = $1`,
        [input.idempotencyKey, canonicalPayload],
      );
      if (existingReceipt.rowCount === 1) {
        const previous = existingReceipt.rows[0]!;
        if (
          !previous.same_payload ||
          previous.transfer_id !== transfer.id ||
          previous.actor_id !== input.actorId ||
          previous.received_at.toISOString() !== new Date(input.receivedAt).toISOString()
        ) {
"""
if old not in text:
    raise SystemExit('receipt semantic replay anchor missing')
text = text.replace(old, new, 1)

# Insert semantic create comparator before simpleTransition.
anchor = """  private async simpleTransition(
"""
helper = """  private async sameCreate(
    client: PoolClient,
    existing: TransferDbRow,
    input: CreateTransferInput,
  ): Promise<boolean> {
    if (
      existing.id !== input.id ||
      existing.event_id !== input.eventId ||
      existing.source_location_id !== input.sourceLocationId ||
      existing.destination_location_id !== input.destinationLocationId ||
      existing.requested_by_actor_id !== input.actorId ||
      existing.request_reason !== input.reason ||
      existing.requested_at.toISOString() !== new Date(input.requestedAt).toISOString()
    ) {
      return false;
    }
    const stored = await this.lines(client, existing.id);
    const requested = [...input.lines].sort((a, b) => a.skuId.localeCompare(b.skuId));
    if (stored.length !== requested.length) return false;
    return stored.every(
      (line, index) =>
        line.sku_id === requested[index]!.skuId &&
        line.requested_quantity === requested[index]!.requestedQuantityBase,
    );
  }

  private async simpleTransition(
"""
if anchor not in text:
    raise SystemExit('sameCreate insertion anchor missing')
text = text.replace(anchor, helper, 1)
save(path, text)

# ---- Regression coverage for concurrent transfer create + semantic replay ----
path = 'apps/event-edge/test/inventory-transfer.integration.test.ts'
text = load(path)
insert = """
  it('serializes concurrent transfer creation and rejects semantic idempotency reuse', async () => {
    const input = {
      id: 'transfer-create-race-001',
      eventId: inventoryEventId,
      sourceLocationId: warehouseLocationId,
      destinationLocationId: mainLocationId,
      actorId: operatorActorId,
      reason: 'concurrent create',
      requestedAt: '2026-08-14T08:00:00.000Z',
      idempotencyKey: 'transfer-create-race-key',
      lines: [{ skuId: beerSkuId, requestedQuantityBase: '25' }],
    };

    const [first, second] = await Promise.all([transfers.create(input), transfers.create(input)]);
    expect(first.id).toBe(input.id);
    expect(second.id).toBe(input.id);

    const rows = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM edge_stock_transfers WHERE id = $1',
      [input.id],
    );
    const history = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM edge_stock_transfer_history
       WHERE transfer_id = $1 AND to_state = 'REQUESTED'`,
      [input.id],
    );
    expect(rows[0]!.count).toBe('1');
    expect(history[0]!.count).toBe('1');

    await expect(
      transfers.create({
        ...input,
        lines: [{ skuId: beerSkuId, requestedQuantityBase: '26' }],
      }),
    ).rejects.toThrow(/idempotency key was reused with different content/);

    await expect(
      transfers.create({
        ...input,
        id: 'transfer-create-duplicate-lines',
        idempotencyKey: 'transfer-create-duplicate-lines-key',
        lines: [
          { skuId: beerSkuId, requestedQuantityBase: '10' },
          { skuId: beerSkuId, requestedQuantityBase: '10' },
        ],
      }),
    ).rejects.toThrow(/must not repeat a SKU/);
  });
"""
if "serializes concurrent transfer creation and rejects semantic idempotency reuse" in text:
    raise SystemExit('transfer hardening test already exists unexpectedly')
pos = text.rfind('\n});')
if pos == -1:
    raise SystemExit('transfer test closing anchor missing')
text = text[:pos] + insert + text[pos:]
save(path, text)

# ---- Regression coverage for ledger ID collision ----
path = 'apps/event-edge/test/inventory-reversal.integration.test.ts'
text = load(path)
insert = """
  it('turns a ledger ID collision into an application conflict without aborting stock truth', async () => {
    await ledger.postManual({
      id: 'manual-ledger-shared-id',
      eventId: inventoryEventId,
      inventoryLocationId: mainLocationId,
      skuId: beerSkuId,
      movementType: 'RECEIPT',
      quantityDeltaBase: '10',
      actorId: operatorActorId,
      reason: 'first movement',
      occurredAt: '2026-08-14T08:00:00.000Z',
      idempotencyKey: 'manual-ledger-first-key',
    });

    await expect(
      ledger.postManual({
        id: 'manual-ledger-shared-id',
        eventId: inventoryEventId,
        inventoryLocationId: mainLocationId,
        skuId: beerSkuId,
        movementType: 'WASTAGE',
        quantityDeltaBase: '-2',
        actorId: operatorActorId,
        reason: 'conflicting movement',
        occurredAt: '2026-08-14T08:01:00.000Z',
        idempotencyKey: 'manual-ledger-second-key',
      }),
    ).rejects.toThrow(/idempotency key was reused with different movement content/);

    const stock = await database.query<{ on_hand: string }>(
      `SELECT on_hand::text FROM edge_inventory_stock_projection
       WHERE event_id = $1 AND inventory_location_id = $2 AND sku_id = $3`,
      [inventoryEventId, mainLocationId, beerSkuId],
    );
    expect(stock[0]!.on_hand).toBe('10');
  });
"""
if "turns a ledger ID collision into an application conflict" in text:
    raise SystemExit('ledger collision test already exists unexpectedly')
pos = text.rfind('\n});')
if pos == -1:
    raise SystemExit('reversal test closing anchor missing')
text = text[:pos] + insert + text[pos:]
save(path, text)

# Remove temporary repair files from the resulting commit.
for temporary in [
    'scripts/task005_safety_repair.py',
    '.github/workflows/task005-safety-repair.yml',
]:
    p = root / temporary
    if p.exists():
        p.unlink()
