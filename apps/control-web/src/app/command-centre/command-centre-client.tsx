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
    : values
        .map((value) => formatMinor(value.currency, value.averageOrderValueMinor))
        .join(' • ');
}

function velocityList(values: CommandCentreCurrencyVelocity[]): string {
  return values.length === 0
    ? '—'
    : values
        .map((value) => `${formatMinor(value.currency, value.amountMinorPerMinute)}/min`)
        .join(' • ');
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      style={{
        background: '#fff',
        border: '1px solid #dedede',
        borderRadius: 14,
        padding: 16,
        minWidth: 0,
      }}
    >
      <h2 style={{ margin: '0 0 12px', fontSize: 18 }}>{title}</h2>
      {children}
    </section>
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
  return (
    <strong
      style={{
        display: 'inline-block',
        padding: '6px 10px',
        borderRadius: 999,
        border: '1px solid currentColor',
        color: stale ? '#a32626' : mode === 'LIVE' ? '#176b3a' : '#7b5c12',
        fontSize: 12,
      }}
    >
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
    <article
      style={{
        border: '1px solid #ddd',
        borderRadius: 12,
        padding: 12,
        background: alert.severity === 'CRITICAL' ? '#fff5f5' : '#fff',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <strong>{alert.title}</strong>
        <small>{alert.severity}</small>
      </div>
      <p style={{ margin: '6px 0' }}>{alert.detail}</p>
      <small>
        {alert.source} • {alert.state}
        {alert.assignedActorId ? ` • assigned ${alert.assignedActorId}` : ''}
      </small>
      {alert.inventoryAlertId && alert.actionable ? (
        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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

  return (
    <main
      style={{
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        maxWidth: 1320,
        margin: '0 auto',
        padding: 24,
        background: '#f7f7f5',
        minHeight: '100vh',
      }}
    >
      <header style={{ marginBottom: 20 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <h1 style={{ marginBottom: 6 }}>Event Command Centre</h1>
            <p style={{ margin: 0 }}>
              Exceptions first. Sales, stock, payments and device health in one view.
            </p>
          </div>
          <StatusPill mode={mode} stale={stale} />
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 8,
            marginTop: 16,
          }}
        >
          <input
            value={organisationId}
            onChange={(event) => setOrganisationId(event.target.value)}
            placeholder="Organisation ID"
            aria-label="Organisation ID"
            style={{ padding: 10 }}
          />
          <input
            value={eventId}
            onChange={(event) => setEventId(event.target.value)}
            placeholder="Event ID"
            aria-label="Event ID"
            style={{ padding: 10 }}
          />
          <button type="button" onClick={() => void load()} style={{ padding: 10 }}>
            Load event
          </button>
        </div>
        {error ? <p style={{ color: '#a32626' }}>{error}</p> : null}
        {snapshot ? (
          <p style={{ marginBottom: 0 }}>
            <strong>{snapshot.event.name}</strong> • {snapshot.event.lifecycle} • generated{' '}
            {new Date(snapshot.freshness.generatedAt).toLocaleTimeString()}
            {stale ? ' • snapshot is stale' : ''}
          </p>
        ) : null}
      </header>

      {!snapshot ? <p>Load an event to begin operational monitoring.</p> : null}
      {snapshot ? (
        <div style={{ display: 'grid', gap: 16 }}>
          <section
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
              gap: 12,
            }}
          >
            <Panel title="Gross sales">
              <strong style={{ fontSize: 22 }}>{moneyList(snapshot.sales.grossSales)}</strong>
            </Panel>
            <Panel title="Transactions">
              <strong style={{ fontSize: 22 }}>{snapshot.sales.transactionCount}</strong>
            </Panel>
            <Panel title="Average order value">
              <strong style={{ fontSize: 22 }}>{averageList(snapshot.sales.averageOrderValue)}</strong>
            </Panel>
            <Panel title="Current sales velocity">
              <strong style={{ fontSize: 22 }}>
                {velocityList(snapshot.sales.currentSalesVelocity)}
              </strong>
            </Panel>
          </section>

          <Panel title={`Action centre • ${snapshot.alerts.length} exception(s)`}>
            {snapshot.alerts.length === 0 ? <p>No active operational exceptions.</p> : null}
            <div style={{ display: 'grid', gap: 10 }}>
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

          <section
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: 16,
            }}
          >
            <Panel title="Which locations are slowing?">
              {snapshot.salesLocations.length === 0 ? <p>No closed sales yet.</p> : null}
              {snapshot.salesLocations.map((location) => (
                <div
                  key={location.salesLocationId}
                  style={{ borderBottom: '1px solid #eee', padding: '9px 0' }}
                >
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
            </Panel>

            <Panel title="Stockout risk">
              {snapshot.inventory.risks.length === 0 ? <p>No active inventory risks.</p> : null}
              {snapshot.inventory.risks.slice(0, 12).map((risk) => (
                <div
                  key={risk.alertId}
                  style={{ borderBottom: '1px solid #eee', padding: '9px 0' }}
                >
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
            </Panel>

            <Panel title="Payment health">
              <p>
                Pending{' '}
                <strong>{(snapshot.payments.attempts.pendingRate * 100).toFixed(1)}%</strong> •
                Unknown{' '}
                <strong>{(snapshot.payments.attempts.unknownRate * 100).toFixed(1)}%</strong> •
                Failed{' '}
                <strong>{(snapshot.payments.attempts.failureRate * 100).toFixed(1)}%</strong>
              </p>
              {snapshot.payments.rails.map((rail) => (
                <div key={rail.providerId}>
                  {rail.providerId}: <strong>{rail.status}</strong>
                  {rail.detailCode ? ` • ${rail.detailCode}` : ''}
                </div>
              ))}
              <h3 style={{ fontSize: 14 }}>Settled method split</h3>
              {snapshot.payments.settledMethods.map((method) => (
                <div key={`${method.providerId}:${method.currency}`}>
                  {method.providerId}: {method.transactionCount} •{' '}
                  {formatMinor(method.currency, method.valueMinor)}
                </div>
              ))}
            </Panel>

            <Panel title="Device sales & sync health">
              {snapshot.devices.length === 0 ? <p>No event devices observed yet.</p> : null}
              {snapshot.devices.map((device) => {
                const salesAvailable = device.transactionCount !== undefined;
                return (
                  <div
                    key={device.deviceId}
                    style={{ borderBottom: '1px solid #eee', padding: '9px 0' }}
                  >
                    <strong>
                      {device.deviceId} • {device.status}
                    </strong>
                    <div>
                      {device.salesLocationName ?? 'Unknown location'} • backlog{' '}
                      {device.edgeBacklogCount}
                    </div>
                    {salesAvailable ? (
                      <div>
                        {device.transactionCount} transactions • {moneyList(device.grossSales ?? [])} •{' '}
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
            </Panel>
          </section>

          <section
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: 16,
            }}
          >
            <Panel title="Top products">
              {snapshot.topProducts.map((product) => (
                <div
                  key={product.skuId}
                  style={{ borderBottom: '1px solid #eee', padding: '8px 0' }}
                >
                  <strong>{product.name}</strong> • {product.quantitySold} sold •{' '}
                  {moneyList(product.grossSales)}
                </div>
              ))}
            </Panel>
            <Panel title="Active transfers">
              {snapshot.inventory.activeTransfers.length === 0 ? <p>No active transfers.</p> : null}
              {snapshot.inventory.activeTransfers.map((transfer) => (
                <div
                  key={transfer.transferId}
                  style={{ borderBottom: '1px solid #eee', padding: '8px 0' }}
                >
                  <strong>{transfer.state}</strong> •{' '}
                  {transfer.sourceLocationName ?? transfer.sourceLocationId} →{' '}
                  {transfer.destinationLocationName ?? transfer.destinationLocationId}
                </div>
              ))}
            </Panel>
          </section>
        </div>
      ) : null}
    </main>
  );
}
