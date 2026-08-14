'use client';

import { useState } from 'react';

type StockRow = {
  inventoryLocationId: string;
  skuId: string;
  onHandBase: string;
};

type AlertRow = {
  id: string;
  alertType: string;
  severity: string;
  state: string;
  inventoryLocationId: string | null;
  skuId: string;
  availableQuantityBase: string;
  minutesOfCover: string | null;
  suggestedSourceLocationId: string | null;
  suggestedTransferQuantityBase: string | null;
  responsibleActorId: string | null;
  assignedActorId: string | null;
};

type TransferRow = {
  id: string;
  sourceLocationId: string;
  destinationLocationId: string;
  state: string;
  assignedActorId: string | null;
  lines: Array<{
    skuId: string;
    requestedQuantityBase: string;
    dispatchedQuantityBase: string;
    receivedQuantityBase: string;
  }>;
};

type Operations = {
  stock: StockRow[];
  alerts: AlertRow[];
  transfers: TransferRow[];
};

const apiBase = process.env.NEXT_PUBLIC_CLOUD_API_URL ?? 'http://localhost:3001';

export function InventoryOperationsClient() {
  const [eventId, setEventId] = useState('');
  const [operations, setOperations] = useState<Operations | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    if (!eventId.trim()) {
      setError('Enter an event ID.');
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(
        `${apiBase}/inventory/events/${encodeURIComponent(eventId.trim())}/operations`,
        { cache: 'no-store' },
      );
      if (!response.ok) throw new Error(`Cloud API returned ${response.status}`);
      setOperations((await response.json()) as Operations);
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to load inventory operations');
    } finally {
      setLoading(false);
    }
  }

  const activeAlerts = operations?.alerts.filter((alert) => alert.state !== 'RESOLVED') ?? [];

  return (
    <section style={{ display: 'grid', gap: 20 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          value={eventId}
          onChange={(event) => setEventId(event.target.value)}
          placeholder="Event ID"
          aria-label="Event ID"
          style={{ minWidth: 320, padding: 10 }}
        />
        <button type="button" onClick={() => void refresh()} disabled={loading}>
          {loading ? 'Loading…' : 'Load inventory'}
        </button>
      </div>

      {error ? <p style={{ color: 'crimson' }}>{error}</p> : null}

      <div>
        <h2>Critical & active alerts</h2>
        {activeAlerts.length === 0 ? <p>No active inventory alerts.</p> : null}
        <div style={{ display: 'grid', gap: 10 }}>
          {activeAlerts.map((alert) => (
            <article
              key={alert.id}
              style={{ border: '1px solid #ddd', borderRadius: 12, padding: 14 }}
            >
              <strong>
                {alert.severity} • {alert.alertType}
              </strong>
              <p style={{ margin: '6px 0' }}>
                {alert.inventoryLocationId ?? 'EVENT-WIDE'} / {alert.skuId} • available{' '}
                {alert.availableQuantityBase} • cover {alert.minutesOfCover ?? 'no active velocity'}{' '}
                min
              </p>
              <p style={{ margin: '6px 0' }}>
                Suggested transfer:{' '}
                {alert.suggestedTransferQuantityBase && alert.suggestedTransferQuantityBase !== '0'
                  ? `${alert.suggestedTransferQuantityBase} from ${alert.suggestedSourceLocationId ?? 'best source'}`
                  : 'none'}
              </p>
              <small>
                State {alert.state} • owner{' '}
                {alert.assignedActorId ?? alert.responsibleActorId ?? 'unassigned'}
              </small>
            </article>
          ))}
        </div>
      </div>

      <div>
        <h2>Stock by location</h2>
        <div style={{ display: 'grid', gap: 8 }}>
          {(operations?.stock ?? []).map((row) => (
            <div key={`${row.inventoryLocationId}:${row.skuId}`}>
              {row.inventoryLocationId} / {row.skuId}: <strong>{row.onHandBase}</strong>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2>Transfers</h2>
        <div style={{ display: 'grid', gap: 10 }}>
          {(operations?.transfers ?? []).map((transfer) => (
            <article
              key={transfer.id}
              style={{ border: '1px solid #ddd', borderRadius: 12, padding: 14 }}
            >
              <strong>{transfer.state}</strong>
              <p style={{ margin: '6px 0' }}>
                {transfer.sourceLocationId} → {transfer.destinationLocationId}
              </p>
              <small>
                {transfer.lines
                  .map(
                    (line) =>
                      `${line.skuId}: ${line.receivedQuantityBase}/${line.dispatchedQuantityBase} received`,
                  )
                  .join(' • ')}
              </small>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
