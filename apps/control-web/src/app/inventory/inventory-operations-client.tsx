'use client';

import type { EventConfigurationView } from '@event-commerce/contracts';
import { useEffect, useMemo, useState } from 'react';
import { eventControlContextChangedEvent, readEventControlContext } from '../event-context';

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
  const [organisationId, setOrganisationId] = useState('');
  const [organisationName, setOrganisationName] = useState('');
  const [eventId, setEventId] = useState('');
  const [eventName, setEventName] = useState('');
  const [operations, setOperations] = useState<Operations | null>(null);
  const [configuration, setConfiguration] = useState<EventConfigurationView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  useEffect(() => {
    const syncContext = () => {
      const context = readEventControlContext();
      setOrganisationId(context.organisationId ?? '');
      setOrganisationName(context.organisationName ?? '');
      setEventId(context.eventId ?? '');
      setEventName(context.eventName ?? '');
      setOperations(null);
      setConfiguration(null);
      setError(null);
      setLastUpdatedAt(null);
    };

    syncContext();
    window.addEventListener(eventControlContextChangedEvent, syncContext);
    return () => window.removeEventListener(eventControlContextChangedEvent, syncContext);
  }, []);

  useEffect(() => {
    if (!organisationId.trim() || !eventId.trim()) return;
    void refresh(organisationId, eventId);
  }, [organisationId, eventId]);

  async function refresh(
    selectedOrganisationId = organisationId,
    selectedEventId = eventId,
  ): Promise<void> {
    const scopedOrganisationId = selectedOrganisationId.trim();
    const scopedEventId = selectedEventId.trim();
    if (!scopedOrganisationId || !scopedEventId) {
      setError('Select an organisation and event from Event Control.');
      return;
    }

    setLoading(true);
    try {
      const requestHeaders: Record<string, string> = {
        'x-event-control-request': 'browser',
        'x-organisation-id': scopedOrganisationId,
      };
      const operationsResponse = await fetch(
        `${apiBase}/inventory/events/${encodeURIComponent(scopedEventId)}/operations`,
        {
          cache: 'no-store',
          credentials: 'include',
          headers: requestHeaders,
        },
      );
      if (!operationsResponse.ok) {
        throw new Error(`Cloud API returned ${operationsResponse.status}`);
      }
      const nextOperations = (await operationsResponse.json()) as Operations;
      setOperations(nextOperations);

      try {
        const configurationResponse = await fetch(
          `${apiBase}/organisations/${encodeURIComponent(scopedOrganisationId)}/configuration`,
          {
            cache: 'no-store',
            credentials: 'include',
            headers: {
              ...requestHeaders,
              'content-type': 'application/json',
            },
          },
        );
        if (configurationResponse.ok) {
          const nextConfiguration = (await configurationResponse.json()) as EventConfigurationView;
          setConfiguration(nextConfiguration);
          setOrganisationName(nextConfiguration.organisation.name);
          const selectedEvent = nextConfiguration.events.find(
            (candidate) => candidate.id === scopedEventId,
          );
          if (selectedEvent) setEventName(selectedEvent.name);
        }
      } catch {
        // Inventory truth remains usable when optional configuration labels are unavailable.
      }

      setLastUpdatedAt(Date.now());
      setError(null);
    } catch (failure) {
      setOperations(null);
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

  const hasContext = Boolean(organisationId.trim() && eventId.trim());

  return (
    <section
      className="ec-operations-stack"
      style={{ marginTop: 18 }}
      aria-busy={loading}
      aria-live="polite"
    >
      {!hasContext ? (
        <div className="ec-callout">
          <strong>Select an event above.</strong> Inventory operations only load for organisations
          and events available to the signed-in operator.
        </div>
      ) : null}

      {error ? <div className="ec-banner ec-banner--danger">{error}</div> : null}

      {hasContext && !operations && !error ? (
        <div className="ec-callout">
          <strong>{loading ? 'Loading inventory…' : 'Inventory is ready to load.'}</strong> Active
          stock risks and transfers appear before the location-by-location stock view.
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
                  Highest severity and lowest cover appear first. Recommended moves are guidance
                  only; stock changes only when the venue transfer workflow records them.
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
                const suggestedQuantity =
                  alert.suggestedTransferQuantityBase && alert.suggestedTransferQuantityBase !== '0'
                    ? alert.suggestedTransferQuantityBase
                    : null;
                const suggestedSource = alert.suggestedSourceLocationId
                  ? locationLabel(alert.suggestedSourceLocationId)
                  : null;
                const ownerId = alert.assignedActorId ?? alert.responsibleActorId;
                return (
                  <article
                    className="ec-alert-card"
                    data-tone={alertTone(alert.severity)}
                    key={alert.id}
                  >
                    <div className="ec-alert-rail" aria-hidden="true" />
                    <div className="ec-alert-card-content">
                      <div className="ec-alert-card-head">
                        <div>
                          <strong className="ec-alert-title">{skuLabel(alert.skuId)}</strong>
                          <div className="ec-alert-meta">
                            {locationLabel(alert.inventoryLocationId)} •{' '}
                            {alert.alertType.replaceAll('_', ' ')}
                          </div>
                        </div>
                        <span className="ec-alert-severity" data-tone={alertTone(alert.severity)}>
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
                      <div
                        className={suggestedQuantity ? 'ec-banner ec-banner--warning' : 'ec-banner'}
                        style={{ marginTop: 12 }}
                      >
                        {suggestedQuantity && suggestedSource ? (
                          <>
                            <strong>Recommended move.</strong> Move {suggestedQuantity}{' '}
                            {skuLabel(alert.skuId)} from {suggestedSource} to{' '}
                            {locationLabel(alert.inventoryLocationId)}.
                          </>
                        ) : suggestedQuantity ? (
                          <>
                            <strong>Replenishment quantity identified.</strong> Move{' '}
                            {suggestedQuantity} {skuLabel(alert.skuId)} to{' '}
                            {locationLabel(alert.inventoryLocationId)} once the venue team confirms
                            a safe source location.
                          </>
                        ) : (
                          <>
                            <strong>No transfer recommendation yet.</strong> Coordinate
                            replenishment locally for {skuLabel(alert.skuId)} at{' '}
                            {locationLabel(alert.inventoryLocationId)}; this screen has no safe
                            source recommendation.
                          </>
                        )}
                        <div className="ec-alert-meta" style={{ marginTop: 6 }}>
                          Record any move through the venue transfer workflow. This Cloud screen
                          does not move stock.
                        </div>
                      </div>
                      <details className="ec-context-switcher" style={{ marginTop: 10 }}>
                        <summary>Alert details</summary>
                        <div className="ec-alert-meta" style={{ marginTop: 8 }}>
                          {alert.state} • {ownerId ? `owner ${compactId(ownerId)}` : 'unassigned'}
                        </div>
                      </details>
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
                    <small>{transfer.assignedActorId ? 'Assigned' : 'Unassigned'}</small>
                    {transfer.assignedActorId ? (
                      <details className="ec-context-switcher">
                        <summary>Transfer details</summary>
                        <small>Owner ID: {compactId(transfer.assignedActorId)}</small>
                      </details>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>

            <section className="ec-panel">
              <div className="ec-panel-heading">
                <div>
                  <h2>Stock by location</h2>
                  <p>
                    Latest stock positions received online; this view can lag venue Edge during
                    outages.
                  </p>
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
