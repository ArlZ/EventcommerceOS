from pathlib import Path
import re

root = Path('.')

def load(path: str) -> str:
    return (root / path).read_text()

def save(path: str, text: str) -> None:
    (root / path).write_text(text)

path = 'apps/event-edge/src/inventory/inventory-count.service.ts'
text = load(path)
pattern = re.compile(
    r"  async create\(input: CreateStockCountInput\): Promise<StockCountResult> \{.*?\n  \}\n\n  async close",
    re.S,
)
replacement = """  async create(input: CreateStockCountInput): Promise<StockCountResult> {
    return this.database.transaction(async (client) => {
      await this.authorization.require(client, input.eventId, input.actorId, 'COUNT_MANAGE');
      if (new Set(input.lines.map((line) => line.skuId)).size !== input.lines.length) {
        throw new ConflictException('stock count lines must not repeat a SKU');
      }
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `stock-count-id:${input.id}`,
      ]);
      const existing = await client.query<CountRow>(
        'SELECT * FROM edge_stock_counts WHERE id = $1',
        [input.id],
      );
      if (existing.rowCount === 1) {
        const row = existing.rows[0]!;
        if (!(await this.sameCreate(client, row, input))) {
          throw new ConflictException('stock count ID was reused with different content');
        }
        return this.result(client, row);
      }

      await client.query(
        `INSERT INTO edge_stock_counts(
           id, event_id, inventory_location_id, state, opened_by_actor_id,
           opened_at, reason
         ) VALUES ($1,$2,$3,'OPEN',$4,$5,$6)`,
        [
          input.id,
          input.eventId,
          input.inventoryLocationId,
          input.actorId,
          input.openedAt,
          input.reason,
        ],
      );
      for (const line of [...input.lines].sort((a, b) => a.skuId.localeCompare(b.skuId))) {
        await client.query(
          `INSERT INTO edge_stock_count_lines(count_id, sku_id, counted_quantity)
           VALUES ($1,$2,$3)`,
          [input.id, line.skuId, line.countedQuantityBase],
        );
      }
      return this.result(client, await this.count(client, input.id, false));
    });
  }

  async close"""
text, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise SystemExit(f'count create replacement count={count}')

anchor = """  private async count(client: PoolClient, id: string, lock: boolean): Promise<CountRow> {
"""
helper = """  private async sameCreate(
    client: PoolClient,
    existing: CountRow,
    input: CreateStockCountInput,
  ): Promise<boolean> {
    if (
      existing.event_id !== input.eventId ||
      existing.inventory_location_id !== input.inventoryLocationId ||
      existing.opened_by_actor_id !== input.actorId ||
      existing.opened_at.toISOString() !== new Date(input.openedAt).toISOString() ||
      existing.reason !== input.reason
    ) {
      return false;
    }
    const stored = await this.lines(client, existing.id);
    const requested = [...input.lines].sort((a, b) => a.skuId.localeCompare(b.skuId));
    if (stored.length !== requested.length) return false;
    return stored.every(
      (line, index) =>
        line.sku_id === requested[index]!.skuId &&
        line.counted_quantity === requested[index]!.countedQuantityBase,
    );
  }

  private async count(client: PoolClient, id: string, lock: boolean): Promise<CountRow> {
"""
if anchor not in text:
    raise SystemExit('count helper insertion anchor missing')
text = text.replace(anchor, helper, 1)
save(path, text)

path = 'apps/event-edge/test/inventory-ledger.integration.test.ts'
text = load(path)
insert = """
  it('serializes identical count creation and rejects changed quantities under the same ID', async () => {
    const input = {
      id: 'count-create-race-002',
      eventId: inventoryEventId,
      inventoryLocationId: mainLocationId,
      actorId: operatorActorId,
      reason: 'cycle count',
      openedAt: '2026-08-14T08:00:00.000Z',
      lines: [{ skuId: beerSkuId, countedQuantityBase: '12' }],
    };

    const [first, second] = await Promise.all([counts.create(input), counts.create(input)]);
    expect(first.id).toBe(input.id);
    expect(second.id).toBe(input.id);

    const rows = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM edge_stock_counts WHERE id = $1',
      [input.id],
    );
    expect(rows[0]!.count).toBe('1');

    await expect(
      counts.create({
        ...input,
        lines: [{ skuId: beerSkuId, countedQuantityBase: '13' }],
      }),
    ).rejects.toThrow(/reused with different content/);

    await expect(
      counts.create({
        ...input,
        id: 'count-duplicate-lines-003',
        lines: [
          { skuId: beerSkuId, countedQuantityBase: '6' },
          { skuId: beerSkuId, countedQuantityBase: '6' },
        ],
      }),
    ).rejects.toThrow(/must not repeat a SKU/);
  });
"""
if "serializes identical count creation" in text:
    raise SystemExit('count replay test already exists unexpectedly')
pos = text.rfind('\n});')
if pos == -1:
    raise SystemExit('inventory ledger test closing anchor missing')
text = text[:pos] + insert + text[pos:]
save(path, text)

for temporary in [
    'scripts/task005_count_repair.py',
    '.github/workflows/task005-count-repair.yml',
]:
    p = root / temporary
    if p.exists():
        p.unlink()
