'use client';

import { useEffect, useMemo, useState } from 'react';
import { readEventControlContext, writeEventControlContext } from '../event-context';

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
const severityOrder: Record<string, number> = {
  CRITICAL: 0,
  URGENT: 1,
  WARNING: 2,
  INFO: 3,
};

function alertTone(severity: string): 'danger' | 'warning' {
  return severity === 'CRITICAL' ? 'danger' : 'warning';
}

function transferProgress(transfer: TransferRow): string {
  return transfer.lines
    .map(
      (line) =>
        `${line.skuId}: ${line.receivedQuantityBase}/${line.dispatchedQuantityBase} received`,
    )
    .join(' • ');
}

function coverMinutes(value: string | null): number {
  if (value === null) return Number.POSITIVE_INFINITY;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

export function InventoryOperationsClient() {
  const [eventId, setEventId] = useState('');
  const [operations, setOperations] = useState<Operations | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const context = readEventControlContext();
    if (context.eventId) setEventId(context.eventId);
  }, []);

  async function refresh() {
    const selectedEventId = eventId.trim();
    if (!selectedEventId) {
      setError('Enter an event ID.');
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(
        `${apiBase}/inventory/events/${encodeURIComponent(selectedEventId)}/operations`,
        { cache: 'no-store' },
      );
      if (!response.ok) throw new Error(`Cloud API returned ${response.status}`);
      setOperations((await response.json()) as Operations);
      writeEventControlContext({ eventId: selectedEventId });
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to load inventory operations');
    } finally {
      setLoading(false);
    }
  }

  const activeAlerts = useMemo(
    () =>
      [...(operations?.alerts.filter((alert) => alert.state !== 'RESOLVED') ?? [])].sort(
        (left, right) =>
          (severityOrder[left.severity] ?? 99) - (severityOrder[right.severity] ?? 99) ||
          coverMinutes(left.minutesOfCover) - coverMinutes(right.minutesOfCover),
      ),
    [operations],
  );
  const criticalAlerts = activeAlerts.filter((alert) => alert.severity === 'CRITICAL');
  const activeTransfers =
    operations?.transfers.filter((transfer) => transfer.state !== 'RECEIVED') ?? [];
  const inventoryTone =
    criticalAlerts.length > 0 ? 'danger' : activeAlerts.length > 0 ? 'warning' : 'success';

  return (
    <section className="ec-operations-stack" style={{ marginTop: 18 }}>
      <div className="ec-context-loader" style={{ gridTemplateColumns: '1fr auto' }}>
        <input
          value={eventId}
          onChange={(event) => setEventId(event.target.value)}
          placeholder="Event ID"
          aria-label="Event ID"
        />
        <button type="button" onClick={() => void refresh()} disabled={loading}>
          {loading ? 'Loading…' : operations ? 'Refresh inventory' : 'Load inventory'}
        </button>
      </div>

      {error ? <div className="ec-banner ec-banner--danger">{error}</div> : null}

      {!operations && !error ? (
        <div className="ec-callout">
          <strong>Start with the event.</strong> Active stock risks and transfers will appear before
          the location-by-location ledger projection. If you already opened this event in Live, its
          event ID is carried into this screen for the current browser tab.
        </div>
      ) : null}

      {operations ? (
        <>
          <div className="ec-context-bar">
            <div>
              <strong>Inventory operations</strong> • event {eventId.trim()}
            </div>
            <span className="ec-status-pill" data-tone={inventoryTone}>
              {criticalAlerts.length > 0
                ? `${criticalAlerts.length} critical risk${criticalAlerts.length === 1 ? '' : 's'}`
                : activeAlerts.length > 0
                  ? `${activeAlerts.length} active risk${activeAlerts.length === 1 ? '' : 's'}`
                  : 'Stock healthy'}
            </span>
          </div>

          <section className="ec-kpi-grid" aria-label="Inventory operations summary">
            <InventoryMetric label="Active alerts" value={activeAlerts.length.toString()} />
            <InventoryMetric label="Critical alerts" value={criticalAlerts.length.toString()} />
            <InventoryMetric
              label="Transfers in progress"
              value={activeTransfers.length.toString()}
            />
            <InventoryMetric label="Stock positions" value={operations.stock.length.toString()} />
          </section>

          <section className="ec-panel ec-panel--priority">
            <div className="ec-panel-heading">
              <div>
                <h2>Stock risks requiring attention</h2>
                <p>
                  Highest severity and lowest cover appear first. A suggestion is guidance, not an
                  inventory movement until the transfer workflow records it.
                </p>
              </div>
              <span className="ec-status-pill" data-tone={inventoryTone}>
                {criticalAlerts.length > 0
                  ? `${criticalAlerts.length} critical`
                  : activeAlerts.length > 0
                    ? `${activeAlerts.length} active`
                    : 'No active risks'}
              </span>
            </div>

            {activeAlerts.length === 0 ? (
              <div className="ec-banner ec-banner--success">No active inventory alerts.</div>
            ) : null}

            <div className="ec-action-list">
              {activeAlerts.map((alert) => {
                const suggestedTransfer =
                  alert.suggestedTransferQuantityBase &&
                  alert.suggestedTransferQuantityBase !== '0';
                return (
                  <article className="ec-alert-card" data-severity={alert.severity} key={alert.id}>
                    <div className="ec-alert-card-head">
                      <div>
                        <strong>{alert.alertType.replaceAll('_', ' ')}</strong>
                        <div className="ec-alert-meta">
                          {alert.inventoryLocationId ?? 'Event-wide'} • {alert.skuId}
                        </div>
                      </div>
                      <span className="ec-status-pill" data-tone={alertTone(alert.severity)}>
                        {alert.severity}
                      </span>
                    </div>
                    <div className="ec-kpi-grid" style={{ marginTop: 12 }}>
                      <InventoryMetric label="Available" value={alert.availableQuantityBase} />
                      <InventoryMetric
                        label="Minutes of cover"
                        value={alert.minutesOfCover ?? 'Unknown'}
                      />
                    </div>
                    <p>
                      {suggestedTransfer
                        ? `Suggested response: move ${alert.suggestedTransferQuantityBase} from ${alert.suggestedSourceLocationId ?? 'the best available source'}.`
                        : 'No transfer recommendation is currently available.'}
                    </p>
                    <div className="ec-alert-meta">
                      {alert.state} • owner{' '}
                      {alert.assignedActorId ?? alert.responsibleActorId ?? 'unassigned'}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="ec-control-grid">
            <section className="ec-panel">
              <div className="ec-panel-heading">
                <div>
                  <h2>Transfers in motion</h2>
                  <p>Follow stock until receipt is recorded at the destination.</p>
                </div>
                <span className="ec-status-pill" data-tone={activeTransfers.length > 0 ? 'warning' : 'success'}>
                  {activeTransfers.length > 0 ? `${activeTransfers.length} in progress` : 'Clear'}
                </span>
              </div>
              {operations.transfers.length === 0 ? (
                <p className="ec-empty">No transfers recorded for this event.</p>
              ) : null}
              <div className="ec-list">
                {operations.transfers.map((transfer) => (
                  <div className="ec-list-row" key={transfer.id}>
                    <strong>
                      {transfer.sourceLocationId} → {transfer.destinationLocationId}
                    </strong>
                    <div>
                      <span
                        className="ec-status-pill"
                        data-tone={transfer.state === 'RECEIVED' ? 'success' : 'warning'}
                      >
                        {transfer.state}
                      </span>
                    </div>
                    <small>{transferProgress(transfer)}</small>
                    <small>Owner: {transfer.assignedActorId ?? 'unassigned'}</small>
                  </div>
                ))}
              </div>
            </section>

            <section className="ec-panel">
              <div className="ec-panel-heading">
                <div>
                  <h2>Stock by location</h2>
                  <p>Current Cloud projection of the append-only stock ledger.</p>
                </div>
                <span className="ec-status-pill">{operations.stock.length} positions</span>
              </div>
              {operations.stock.length === 0 ? (
                <p className="ec-empty">No stock positions reported.</p>
              ) : null}
              <div className="ec-list">
                {operations.stock.map((row) => (
                  <div className="ec-list-row" key={`${row.inventoryLocationId}:${row.skuId}`}>
                    <strong>{row.skuId}</strong>
                    <div>{row.inventoryLocationId}</div>
                    <small>On hand: {row.onHandBase}</small>
                  </div>
                ))}
              </div>
            </section>
          </section>
        </>
      ) : null}
    </section>
  );
}

function InventoryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="ec-kpi">
      <span className="ec-kpi-label">{label}</span>
      <strong className="ec-kpi-value">{value}</strong>
    </div>
  );
}
