'use client';

import type {
  CommandCentreAlert,
  CommandCentreCurrencyAmount,
  CommandCentreCurrencyAverage,
  CommandCentreCurrencyVelocity,
  CommandCentreInventoryAlertActionView,
  CommandCentreSnapshot,
} from '@event-commerce/contracts';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  COMMAND_CENTRE_POLL_INTERVAL_MS,
  nextRealtimeMode,
  snapshotIsStale,
  type CommandCentreRealtimeMode,
} from './command-centre-state';

const apiBase = process.env.NEXT_PUBLIC_CLOUD_API_URL ?? 'http://localhost:3001';
type ActiveEvent = { organisationId: string; eventId: string };

function requestHeaders(actorId: string, organisationId: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-actor-id': actorId,
    'x-role': 'ADMIN',
    'x-organisation-id': organisationId,
  };
}

async function commandCentreRequest<T>(
  path: string,
  actorId: string,
  organisationId: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(requestHeaders(actorId, organisationId));
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
}

function formatMinor(currency: string, amountMinor: string): string {
  const amount = Number(amountMinor) / 100;
  if (!Number.isFinite(amount)) return `${currency} ${amountMinor} minor`;
  try {
    return new Intl.NumberFormat('en-KE', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function moneyList(values: CommandCentreCurrencyAmount[]): string {
  return values.length === 0
    ? '—'
    : values.map((value) => formatMinor(value.currency, value.amountMinor)).join(' • ');
}

function averageList(values: CommandCentreCurrencyAverage[]): string {
  return values.length === 0
    ? '—'
    : values.map((value) => formatMinor(value.currency, value.averageOrderValueMinor)).join(' • ');
}

function velocityList(values: CommandCentreCurrencyVelocity[]): string {
  return values.length === 0
    ? '—'
    : values
        .map((value) => `${formatMinor(value.currency, value.amountMinorPerMinute)}/min`)
        .join(' • ');
}

function Panel({
  title,
  description,
  priority = false,
  children,
}: {
  title: string;
  description?: string;
  priority?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`ec-panel${priority ? ' ec-panel--priority' : ''}`}>
      <div className="ec-panel-heading">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="ec-kpi">
      <span className="ec-kpi-label">{label}</span>
      <strong className="ec-kpi-value">{value}</strong>
    </div>
  );
}

function StatusPill({ mode, stale }: { mode: CommandCentreRealtimeMode; stale: boolean }) {
  const label = stale
    ? 'STALE DATA'
    : mode === 'LIVE'
      ? 'LIVE'
      : mode === 'POLLING'
        ? 'POLLING'
        : mode === 'CONNECTING'
          ? 'CONNECTING'
          : 'NOT CONNECTED';
  const tone = stale ? 'danger' : mode === 'LIVE' ? 'success' : 'warning';
  return (
    <strong className="ec-status-pill" data-tone={tone}>
      {label}
    </strong>
  );
}

function AlertCard({
  alert,
  busy,
  onAcknowledge,
  onAssign,
}: {
  alert: CommandCentreAlert;
  busy: boolean;
  onAcknowledge: () => void;
  onAssign: () => void;
}) {
  return (
    <article className="ec-alert-card" data-severity={alert.severity}>
      <div className="ec-alert-card-head">
        <strong>{alert.title}</strong>
        <span
          className="ec-status-pill"
          data-tone={alert.severity === 'CRITICAL' ? 'danger' : 'warning'}
        >
          {alert.severity}
        </span>
      </div>
      <p>{alert.detail}</p>
      <div className="ec-alert-meta">
        {alert.source} • {alert.state}
        {alert.assignedActorId ? ` • assigned ${alert.assignedActorId}` : ''}
      </div>
      {alert.inventoryAlertId && alert.actionable ? (
        <div className="ec-alert-actions">
          {alert.state === 'OPEN' ? (
            <button type="button" disabled={busy} onClick={onAcknowledge}>
              Acknowledge
            </button>
          ) : null}
          <button type="button" disabled={busy} onClick={onAssign}>
            Assign to me
          </button>
        </div>
      ) : null}
    </article>
  );
}

async function consumeSse(
  response: Response,
  onMessage: (value: unknown) => Promise<void>,
): Promise<void> {
  if (!response.body) throw new Error('Realtime response has no stream body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    buffer += decoder.decode(next.value, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';
    for (const block of blocks) {
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('\n');
      if (data) await onMessage(JSON.parse(data) as unknown);
    }
  }
  throw new Error('Realtime stream ended');
}

export function CommandCentreClient() {
  const actorId = useMemo(() => crypto.randomUUID(), []);
  const [organisationId, setOrganisationId] = useState('');
  const [eventId, setEventId] = useState('');
  const [active, setActive] = useState<ActiveEvent | null>(null);
  const [snapshot, setSnapshot] = useState<CommandCentreSnapshot | null>(null);
  const [mode, setMode] = useState<CommandCentreRealtimeMode>('IDLE');
  const [error, setError] = useState<string | null>(null);
  const [busyAlertId, setBusyAlertId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const fetchSnapshot = useCallback(
    async (target: ActiveEvent): Promise<void> => {
      const next = await commandCentreRequest<CommandCentreSnapshot>(
        `/command-centre/events/${encodeURIComponent(target.eventId)}`,
        actorId,
        target.organisationId,
      );
      setSnapshot(next);
      setError(null);
    },
    [actorId],
  );

  async function load(): Promise<void> {
    const target = { organisationId: organisationId.trim(), eventId: eventId.trim() };
    if (!target.organisationId || !target.eventId) {
      setError('Enter both organisation ID and event ID.');
      return;
    }
    try {
      await fetchSnapshot(target);
      setActive(target);
      setMode((current) => nextRealtimeMode(current, 'CONNECT'));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to load event command centre');
    }
  }

  useEffect(() => {
    const timerId = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(timerId);
  }, []);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setMode((current) => nextRealtimeMode(current, 'CONNECT'));
    void (async () => {
      try {
        const response = await fetch(
          `${apiBase}/command-centre/events/${encodeURIComponent(active.eventId)}/stream`,
          {
            headers: requestHeaders(actorId, active.organisationId),
            cache: 'no-store',
            signal: controller.signal,
          },
        );
        if (!response.ok) throw new Error(`Realtime channel returned ${response.status}`);
        setMode((current) => nextRealtimeMode(current, 'STREAM_CONNECTED'));
        await consumeSse(response, async () => fetchSnapshot(active));
      } catch (failure) {
        if (controller.signal.aborted) return;
        setMode((current) => nextRealtimeMode(current, 'STREAM_FAILED'));
        setError(
          failure instanceof Error
            ? `Realtime unavailable; polling instead. ${failure.message}`
            : 'Realtime unavailable; polling instead.',
        );
      }
    })();
    return () => controller.abort();
  }, [active, actorId, fetchSnapshot]);

  useEffect(() => {
    if (!active || mode !== 'POLLING') return;
    const timerId = window.setInterval(() => {
      void fetchSnapshot(active).catch((failure: unknown) => {
        setError(
          failure instanceof Error
            ? `Refresh failed; showing last known snapshot. ${failure.message}`
            : 'Refresh failed; showing last known snapshot.',
        );
      });
    }, COMMAND_CENTRE_POLL_INTERVAL_MS);
    return () => window.clearInterval(timerId);
  }, [active, fetchSnapshot, mode]);

  async function act(alertId: string, action: 'ACKNOWLEDGE' | 'ASSIGN'): Promise<void> {
    if (!active) return;
    setBusyAlertId(alertId);
    try {
      await commandCentreRequest<CommandCentreInventoryAlertActionView>(
        `/command-centre/events/${encodeURIComponent(active.eventId)}/inventory-alerts/${encodeURIComponent(alertId)}/actions`,
        actorId,
        active.organisationId,
        {
          method: 'POST',
          body: JSON.stringify({
            action,
            ...(action === 'ASSIGN' ? { assignedActorId: actorId } : {}),
          }),
        },
      );
      await fetchSnapshot(active);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to update alert');
    } finally {
      setBusyAlertId(null);
    }
  }

  const stale = mode === 'LIVE' ? false : snapshotIsStale(snapshot, now);
  const criticalAlertCount =
    snapshot?.alerts.filter((alert) => alert.severity === 'CRITICAL').length ?? 0;

  return (
    <main className="ec-page ec-page--wide">
      <header className="ec-page-header">
        <div>
          <p className="ec-page-kicker">Live operations</p>
          <h1 className="ec-page-title">Event command centre</h1>
          <p className="ec-page-description">
            Start with exceptions and data freshness. Then use sales, stock, payments and device
            detail to decide where the operating team should act next.
          </p>
        </div>
        <StatusPill mode={mode} stale={stale} />
      </header>

      <div className="ec-operations-stack">
        <div className="ec-context-loader">
          <input
            value={organisationId}
            onChange={(event) => setOrganisationId(event.target.value)}
            placeholder="Organisation ID"
            aria-label="Organisation ID"
          />
          <input
            value={eventId}
            onChange={(event) => setEventId(event.target.value)}
            placeholder="Event ID"
            aria-label="Event ID"
          />
          <button type="button" onClick={() => void load()}>
            Load live event
          </button>
        </div>

        {error ? <div className="ec-banner ec-banner--warning">{error}</div> : null}

        {snapshot ? (
          <div className="ec-context-bar">
            <div>
              <strong>{snapshot.event.name}</strong> • {snapshot.event.lifecycle}
            </div>
            <div>
              Snapshot generated {new Date(snapshot.freshness.generatedAt).toLocaleTimeString()}
            </div>
          </div>
        ) : null}

        {snapshot && stale ? (
          <div className="ec-banner ec-banner--danger">
            <strong>Do not treat this screen as current truth.</strong> Live streaming is unavailable
            or this snapshot is old. Local POS selling can continue; investigate connectivity before
            acting on dashboard timing alone.
          </div>
        ) : null}

        {!snapshot ? (
          <div className="ec-callout">
            <strong>Choose an event to start.</strong> The live view will prioritise exceptions,
            payment uncertainty, stock risk and delayed registers before performance detail.
          </div>
        ) : null}

        {snapshot ? (
          <>
            <Panel
              title={`Action centre • ${snapshot.alerts.length} exception(s)`}
              description="Resolve or assign operational exceptions before reading the rest of the dashboard."
              priority
            >
              <div style={{ marginBottom: 12 }}>
                <span
                  className="ec-status-pill"
                  data-tone={criticalAlertCount > 0 ? 'danger' : snapshot.alerts.length > 0 ? 'warning' : 'success'}
                >
                  {criticalAlertCount > 0
                    ? `${criticalAlertCount} critical`
                    : snapshot.alerts.length > 0
                      ? 'Attention required'
                      : 'No active exceptions'}
                </span>
              </div>
              {snapshot.alerts.length === 0 ? (
                <div className="ec-banner ec-banner--success">
                  No active operational exceptions are currently projected.
                </div>
              ) : null}
              <div className="ec-action-list">
                {snapshot.alerts.map((alert) => (
                  <AlertCard
                    key={alert.id}
                    alert={alert}
                    busy={busyAlertId === alert.inventoryAlertId}
                    onAcknowledge={() => {
                      if (alert.inventoryAlertId) void act(alert.inventoryAlertId, 'ACKNOWLEDGE');
                    }}
                    onAssign={() => {
                      if (alert.inventoryAlertId) void act(alert.inventoryAlertId, 'ASSIGN');
                    }}
                  />
                ))}
              </div>
            </Panel>

            <section className="ec-kpi-grid" aria-label="Event sales snapshot">
              <Metric label="Gross sales" value={moneyList(snapshot.sales.grossSales)} />
              <Metric label="Transactions" value={snapshot.sales.transactionCount} />
              <Metric
                label="Average order value"
                value={averageList(snapshot.sales.averageOrderValue)}
              />
              <Metric
                label="Current sales velocity"
                value={velocityList(snapshot.sales.currentSalesVelocity)}
              />
            </section>

            <section className="ec-control-grid">
              <Panel
                title="Location performance"
                description="Find bars or sales points that may need staffing or operational attention."
              >
                {snapshot.salesLocations.length === 0 ? (
                  <p className="ec-empty">No closed sales yet.</p>
                ) : null}
                <div className="ec-list">
                  {snapshot.salesLocations.map((location) => (
                    <div className="ec-list-row" key={location.salesLocationId}>
                      <strong>{location.name}</strong>
                      <div>
                        {location.transactionCount} transactions • {moneyList(location.grossSales)}
                      </div>
                      <small>
                        {velocityList(location.currentSalesVelocity)} • last sale{' '}
                        {location.lastSaleAt
                          ? new Date(location.lastSaleAt).toLocaleTimeString()
                          : 'never'}
                      </small>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel
                title="Stockout risk"
                description="Prioritise products with low cover and safe replenishment options."
              >
                {snapshot.inventory.risks.length === 0 ? (
                  <p className="ec-empty">No active inventory risks.</p>
                ) : null}
                <div className="ec-list">
                  {snapshot.inventory.risks.slice(0, 12).map((risk) => (
                    <div className="ec-list-row" key={risk.alertId}>
                      <strong>
                        {risk.severity} • {risk.skuName}
                      </strong>
                      <div>
                        {risk.inventoryLocationName ?? 'Event-wide'} • available{' '}
                        {risk.availableQuantityBase}
                      </div>
                      <small>
                        {risk.minutesOfCover ?? 'Unknown'} min cover
                        {risk.suggestedTransferQuantityBase
                          ? ` • suggest ${risk.suggestedTransferQuantityBase} from ${risk.suggestedSourceLocationName ?? risk.suggestedSourceLocationId ?? 'best source'}`
                          : ''}
                      </small>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel
                title="Payment health"
                description="Unknown and pending payments need attention before anyone attempts another charge."
              >
                <div className="ec-kpi-grid">
                  <Metric
                    label="Pending"
                    value={`${(snapshot.payments.attempts.pendingRate * 100).toFixed(1)}%`}
                  />
                  <Metric
                    label="Unknown"
                    value={`${(snapshot.payments.attempts.unknownRate * 100).toFixed(1)}%`}
                  />
                  <Metric
                    label="Failed"
                    value={`${(snapshot.payments.attempts.failureRate * 100).toFixed(1)}%`}
                  />
                </div>
                <div className="ec-list" style={{ marginTop: 12 }}>
                  {snapshot.payments.rails.map((rail) => (
                    <div className="ec-list-row" key={rail.providerId}>
                      <strong>{rail.providerId}</strong> • {rail.status}
                      {rail.detailCode ? ` • ${rail.detailCode}` : ''}
                    </div>
                  ))}
                </div>
                <h3 style={{ fontSize: 14 }}>Settled method split</h3>
                <div className="ec-list">
                  {snapshot.payments.settledMethods.map((method) => (
                    <div className="ec-list-row" key={`${method.providerId}:${method.currency}`}>
                      {method.providerId}: {method.transactionCount} •{' '}
                      {formatMinor(method.currency, method.valueMinor)}
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel
                title="Register & sync health"
                description="A delayed dashboard does not mean a register has lost its locally committed sales."
              >
                {snapshot.devices.length === 0 ? (
                  <p className="ec-empty">No event devices observed yet.</p>
                ) : null}
                <div className="ec-list">
                  {snapshot.devices.map((device) => {
                    const salesAvailable = device.transactionCount !== undefined;
                    return (
                      <div className="ec-list-row" key={device.deviceId}>
                        <strong>
                          {device.deviceId} • {device.status}
                        </strong>
                        <div>
                          {device.salesLocationName ?? 'Unknown location'} • backlog{' '}
                          {device.edgeBacklogCount}
                        </div>
                        {salesAvailable ? (
                          <div>
                            {device.transactionCount} transactions •{' '}
                            {moneyList(device.grossSales ?? [])} •{' '}
                            {velocityList(device.currentSalesVelocity ?? [])}
                          </div>
                        ) : (
                          <div>Device sales detail temporarily unavailable.</div>
                        )}
                        <small>
                          {device.syncAgeSeconds === null
                            ? 'No heartbeat'
                            : `${device.syncAgeSeconds}s since heartbeat`}
                        </small>
                      </div>
                    );
                  })}
                </div>
              </Panel>
            </section>

            <section className="ec-control-grid">
              <Panel title="Top products" description="Current sales mix from closed event orders.">
                <div className="ec-list">
                  {snapshot.topProducts.map((product) => (
                    <div className="ec-list-row" key={product.skuId}>
                      <strong>{product.name}</strong> • {product.quantitySold} sold •{' '}
                      {moneyList(product.grossSales)}
                    </div>
                  ))}
                </div>
              </Panel>
              <Panel
                title="Active transfers"
                description="Stock in motion remains visible until receipt is recorded."
              >
                {snapshot.inventory.activeTransfers.length === 0 ? (
                  <p className="ec-empty">No active transfers.</p>
                ) : null}
                <div className="ec-list">
                  {snapshot.inventory.activeTransfers.map((transfer) => (
                    <div className="ec-list-row" key={transfer.transferId}>
                      <strong>{transfer.state}</strong> •{' '}
                      {transfer.sourceLocationName ?? transfer.sourceLocationId} →{' '}
                      {transfer.destinationLocationName ?? transfer.destinationLocationId}
                    </div>
                  ))}
                </div>
              </Panel>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
