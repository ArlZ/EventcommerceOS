'use client';

import type { EventConfigurationView } from '@event-commerce/contracts';
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

function compactId(value: string): string {
  if (value.length <= 20) return value;
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function coverMinutes(value: string | null): number {
  if (value === null) return Number.POSITIVE_INFINITY;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function updatedLabel(value: number | null): string {
  if (value === null) return 'Not loaded yet';
  const seconds = Math.max(0, Math.floor((Date.now() - value) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

export function InventoryOperationsClient() {
  const actorId = useMemo(() => crypto.randomUUID(), []);
  const [organisationId, setOrganisationId] = useState('');
  const [organisationName, setOrganisationName] = useState('');
  const [eventId, setEventId] = useState('');
  const [eventName, setEventName] = useState('');
  const [operations, setOperations] = useState<Operations | null>(null);
  const [configuration, setConfiguration] = useState<EventConfigurationView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [contextHydrated, setContextHydrated] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  useEffect(() => {
    const context = readEventControlContext();
    if (context.organisationId) setOrganisationId(context.organisationId);
    if (context.organisationName) setOrganisationName(context.organisationName);
    if (context.eventId) setEventId(context.eventId);
    if (context.eventName) setEventName(context.eventName);
    setContextHydrated(true);
  }, []);

  useEffect(() => {
    if (!contextHydrated || !eventId.trim()) return;
    void refresh();
  }, [contextHydrated]);

  async function refresh() {
    const selectedEventId = eventId.trim();
    if (!selectedEventId) {
      setError('Enter an event ID.');
      return;
    }
    setLoading(true);
    try {
      const requestHeaders: Record<string, string> = {
        'x-actor-id': actorId,
        'x-role': 'ADMIN',
        ...(organisationId.trim() ? { 'x-organisation-id': organisationId.trim() } : {}),
      };
      const operationsResponse = await fetch(
        `${apiBase}/inventory/events/${encodeURIComponent(selectedEventId)}/operations`,
        { cache: 'no-store', headers: requestHeaders },
      );
      if (!operationsResponse.ok) {
        throw new Error(`Cloud API returned ${operationsResponse.status}`);
      }
      const nextOperations = (await operationsResponse.json()) as Operations;
      setOperations(nextOperations);

      let nextConfiguration: EventConfigurationView | null = null;
      const selectedOrganisationId = organisationId.trim();
      if (selectedOrganisationId) {
        try {
          const configurationResponse = await fetch(
            `${apiBase}/organisations/${encodeURIComponent(selectedOrganisationId)}/configuration`,
            {
              cache: 'no-store',
              headers: {
                ...requestHeaders,
                'content-type': 'application/json',
              },
            },
          );
          if (configurationResponse.ok) {
            nextConfiguration = (await configurationResponse.json()) as EventConfigurationView;
            setConfiguration(nextConfiguration);
            setOrganisationName(nextConfiguration.organisation.name);
            const selectedEvent = nextConfiguration.events.find(
              (candidate) => candidate.id === selectedEventId,
            );
            if (selectedEvent) setEventName(selectedEvent.name);
          }
        } catch {
          // Inventory truth remains usable when optional configuration labels are unavailable.
        }
      }

      const selectedEventName =
        nextConfiguration?.events.find((candidate) => candidate.id === selectedEventId)?.name ??
        eventName;
      writeEventControlContext({
        ...(selectedOrganisationId ? { organisationId: selectedOrganisationId } : {}),
        ...(nextConfiguration?.organisation.name
          ? { organisationName: nextConfiguration.organisation.name }
          : organisationName
            ? { organisationName }
            : {}),
        eventId: selectedEventId,
        ...(selectedEventName ? { eventName: selectedEventName } : {}),
      });
      setLastUpdatedAt(Date.now());
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

  const inventoryLocationNames = useMemo(
    () =>
      new Map(
        (configuration?.inventoryLocations ?? []).map((location) => [location.id, location.name]),
      ),
    [configuration],
  );
  const skuNames = useMemo(
    () => new Map((configuration?.skus ?? []).map((sku) => [sku.id, sku.name])),
    [configuration],
  );

  function locationLabel(id: string | null): string {
    if (!id) return 'Event-wide';
    return inventoryLocationNames.get(id) ?? `Location ${compactId(id)}`;
  }

  function skuLabel(id: string): string {
    return skuNames.get(id) ?? `SKU ${compactId(id)}`;
  }

  function transferProgress(transfer: TransferRow): string {
    return transfer.lines
      .map(
        (line) =>
          `${skuLabel(line.skuId)}: ${line.receivedQuantityBase}/${line.dispatchedQuantityBase} received`,
      )
      .join(' • ');
  }

  return (
    <section
      className="ec-operations-stack"
      style={{ marginTop: 18 }}
      aria-busy={loading}
      aria-live="polite"
    >
      {operations ? (
        <details className="ec-context-switcher">
          <summary>Change event context</summary>
          <div
            className="ec-context-loader ec-context-loader--embedded"
            style={{ gridTemplateColumns: '1fr auto' }}
          >
            <input
              value={eventId}
              onChange={(event) => {
                setEventId(event.target.value);
                setEventName('');
              }}
              placeholder="Event ID"
              aria-label="Event ID"
            />
            <button type="button" onClick={() => void refresh()} disabled={loading}>
              {loading ? 'Loading…' : 'Load event'}
            </button>
          </div>
        </details>
      ) : (
        <div className="ec-context-loader" style={{ gridTemplateColumns: '1fr auto' }}>
          <input
            value={eventId}
            onChange={(event) => {
              setEventId(event.target.value);
              setEventName('');
            }}
            placeholder="Event ID"
            aria-label="Event ID"
          />
          <button type="button" onClick={() => void refresh()} disabled={loading}>
            {loading ? 'Loading…' : 'Load inventory'}
          </button>
        </div>
      )}

      {error ? <div className="ec-banner ec-banner--danger">{error}</div> : null}

      {!operations && !error ? (
        <div className="ec-callout">
          <strong>Start with the event.</strong> Active stock risks and transfers will appear before
          the location-by-location ledger projection. If you already selected this event elsewhere
          in Event Control, its context is carried into this screen for the current browser tab.
        </div>
      ) : null}

      {operations ? (
        <>
          <div className="ec-context-bar">
            <div>
              <strong>{eventName || 'Inventory operations'}</strong>
              {organisationName ? ` • ${organisationName}` : ''}
              <span className="ec-context-subtle"> • updated {updatedLabel(lastUpdatedAt)}</span>
            </div>
            <div className="ec-context-bar-actions">
              <button type="button" onClick={() => void refresh()} disabled={loading}>
                {loading ? 'Refreshing…' : 'Refresh inventory'}
              </button>
              <span className="ec-status-pill" data-tone={inventoryTone}>
                {criticalAlerts.length > 0
                  ? `${criticalAlerts.length} critical risk${criticalAlerts.length === 1 ? '' : 's'}`
                  : activeAlerts.length > 0
                    ? `${activeAlerts.length} active risk${activeAlerts.length === 1 ? '' : 's'}`
                    : 'Stock healthy'}
              </span>
            </div>
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
              <div className="ec-empty-state" data-tone="success">
                <strong>No active inventory alerts.</strong> Current Cloud projections do not show a
                stock risk requiring action.
              </div>
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
                          {locationLabel(alert.inventoryLocationId)} • {skuLabel(alert.skuId)}
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
                        ? `Suggested response: move ${alert.suggestedTransferQuantityBase} from ${locationLabel(alert.suggestedSourceLocationId)}.`
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
                <span
                  className="ec-status-pill"
                  data-tone={activeTransfers.length > 0 ? 'warning' : 'success'}
                >
                  {activeTransfers.length > 0 ? `${activeTransfers.length} in progress` : 'Clear'}
                </span>
              </div>
              {operations.transfers.length === 0 ? (
                <div className="ec-empty-state">
                  No transfers have been recorded for this event yet.
                </div>
              ) : null}
              <div className="ec-list">
                {operations.transfers.map((transfer) => (
                  <div className="ec-list-row" key={transfer.id}>
                    <strong>
                      {locationLabel(transfer.sourceLocationId)} →{' '}
                      {locationLabel(transfer.destinationLocationId)}
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
                <div className="ec-empty-state">No stock positions have been reported.</div>
              ) : null}
              <div className="ec-list">
                {operations.stock.map((row) => (
                  <div className="ec-list-row" key={`${row.inventoryLocationId}:${row.skuId}`}>
                    <strong>{skuLabel(row.skuId)}</strong>
                    <div>{locationLabel(row.inventoryLocationId)}</div>
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
