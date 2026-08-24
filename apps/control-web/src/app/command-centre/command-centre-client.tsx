'use client';

import type {
  CommandCentreAlert,
  CommandCentreCurrencyAmount,
  CommandCentreCurrencyAverage,
  CommandCentreCurrencyVelocity,
  CommandCentreInventoryAlertActionView,
  CommandCentreSnapshot,
} from '@event-commerce/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  COMMAND_CENTRE_POLL_INTERVAL_MS,
  nextRealtimeMode,
  snapshotIsStale,
  type CommandCentreRealtimeMode,
} from './command-centre-state';
import { readEventControlContext, writeEventControlContext } from '../event-context';

const apiBase = process.env.NEXT_PUBLIC_CLOUD_API_URL ?? 'http://localhost:3001';
const lifecycleSteps = ['DRAFT', 'CONFIGURED', 'READY', 'LIVE', 'CLOSING', 'RECONCILED', 'CLOSED'];

type ActiveEvent = { organisationId: string; eventId: string };
type Tone = 'success' | 'warning' | 'danger' | 'neutral';

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
    return new Intl.NumberFormat('en-KE', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
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

function formatTime(value: string | null): string {
  if (!value) return 'never';
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function ageLabel(value: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function Panel({
  title,
  meta,
  action,
  className = '',
  children,
}: {
  title: string;
  meta?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`ec-panel ${className}`.trim()}>
      <div className="ec-panel-heading">
        <div>
          <h2>{title}</h2>
          {meta ? <p>{meta}</p> : null}
        </div>
        {action ? <div className="ec-panel-action">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

function Metric({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="ec-kpi" data-tone={tone}>
      <span className="ec-kpi-label">{label}</span>
      <strong className="ec-kpi-value">{value}</strong>
      {sub ? <span className="ec-kpi-sub">{sub}</span> : null}
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
  const tone: Tone = stale
    ? 'danger'
    : mode === 'LIVE'
      ? 'success'
      : mode === 'IDLE'
        ? 'neutral'
        : 'warning';
  return (
    <strong className="ec-status-pill" data-tone={tone}>
      <span className="ec-status-dot" aria-hidden="true" />
      {label}
    </strong>
  );
}

function StatusChip({ label, tone }: { label: string; tone: Tone }) {
  return (
    <span className="ec-health-chip" data-tone={tone}>
      <span className="ec-health-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

function LifecycleTrack({ current }: { current: string }) {
  const normalized = current.toUpperCase();
  const currentIndex = lifecycleSteps.indexOf(normalized);
  if (currentIndex < 0) return null;
  return (
    <div className="ec-lifecycle" aria-label={`Event lifecycle: ${current}`}>
      {lifecycleSteps.map((step, index) => {
        const done = index < currentIndex;
        const active = index === currentIndex;
        return (
          <div className="ec-lifecycle-fragment" key={step}>
            <div className="ec-lifecycle-step" data-done={done} data-active={active}>
              <span className="ec-lifecycle-dot" aria-hidden="true">
                {done ? '✓' : ''}
              </span>
              <span>{step.charAt(0) + step.slice(1).toLowerCase()}</span>
            </div>
            {index < lifecycleSteps.length - 1 ? (
              <span className="ec-lifecycle-line" data-done={done} aria-hidden="true" />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function alertTone(alert: CommandCentreAlert): Tone {
  if (alert.severity === 'CRITICAL') return 'danger';
  if (alert.severity === 'URGENT' || alert.severity === 'WARNING') return 'warning';
  return 'neutral';
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
  const tone = alertTone(alert);
  return (
    <article className="ec-alert-card" data-tone={tone}>
      <span className="ec-alert-rail" aria-hidden="true" />
      <div className="ec-alert-card-content">
        <div className="ec-alert-card-head">
          <span className="ec-alert-severity" data-tone={tone}>
            {alert.severity}
          </span>
          <small>{alert.source}</small>
        </div>
        <strong className="ec-alert-title">{alert.title}</strong>
        <p>{alert.detail}</p>
        <div className="ec-alert-meta">
          {alert.state}
          {alert.assignedActorId ? ' • assigned' : ''} • {formatTime(alert.openedAt)}
        </div>
        {alert.inventoryAlertId && alert.actionable ? (
          <div className="ec-alert-actions">
            {alert.state === 'OPEN' ? (
              <button type="button" disabled={busy} onClick={onAcknowledge}>
                Acknowledge
              </button>
            ) : null}
            <button type="button" className="ec-button-primary" disabled={busy} onClick={onAssign}>
              Assign to me
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function paymentState(snapshot: CommandCentreSnapshot): {
  tone: Tone;
  label: string;
  detail: string;
} {
  const attempts = snapshot.payments.attempts;
  const unavailableRails = snapshot.payments.rails.filter(
    (rail) => rail.status !== 'AVAILABLE',
  ).length;
  if (attempts.unknownCount > 0) {
    return {
      tone: 'danger',
      label: `${attempts.unknownCount} unknown`,
      detail: `${moneyList(attempts.unknownValue)} requires reconciliation`,
    };
  }
  if (attempts.pendingCount > 0 || attempts.failedCount > 0 || unavailableRails > 0) {
    return {
      tone: 'warning',
      label: `${attempts.pendingCount} pending · ${attempts.failedCount} failed`,
      detail:
        unavailableRails > 0
          ? `${unavailableRails} payment rail issue(s)`
          : 'No unknown payment state',
    };
  }
  if (attempts.totalCount === 0) {
    return { tone: 'neutral', label: 'No attempts yet', detail: 'No payment attempts recorded' };
  }
  return { tone: 'success', label: 'Healthy', detail: 'No pending, failed or unknown attempts' };
}

function deviceState(snapshot: CommandCentreSnapshot): {
  tone: Tone;
  healthy: number;
  degraded: number;
  stale: number;
  issues: number;
} {
  const healthy = snapshot.devices.filter((device) => device.status === 'HEALTHY').length;
  const degraded = snapshot.devices.filter((device) => device.status === 'DEGRADED').length;
  const stale = snapshot.devices.filter((device) => device.status === 'STALE').length;
  return {
    tone:
      stale > 0
        ? 'danger'
        : degraded > 0
          ? 'warning'
          : snapshot.devices.length > 0
            ? 'success'
            : 'neutral',
    healthy,
    degraded,
    stale,
    issues: degraded + stale,
  };
}

function SystemStatusRow({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: Tone;
}) {
  return (
    <div className="ec-system-row">
      <span className="ec-system-dot" data-tone={tone} aria-hidden="true" />
      <span className="ec-system-copy">
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
      <span className="ec-system-value" data-tone={tone}>
        {value}
      </span>
    </div>
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
  const [contextHydrated, setContextHydrated] = useState(false);
  const [loadingContext, setLoadingContext] = useState(false);
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
      const currentContext = readEventControlContext();
      writeEventControlContext({
        organisationId: target.organisationId,
        organisationName:
          currentContext.organisationId === target.organisationId
            ? (currentContext.organisationName ?? null)
            : null,
        eventId: target.eventId,
        eventName: next.event.name,
      });
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
    setLoadingContext(true);
    try {
      await fetchSnapshot(target);
      setActive(target);
      setMode((current) => nextRealtimeMode(current, 'CONNECT'));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to load event command centre');
    } finally {
      setLoadingContext(false);
    }
  }

  useEffect(() => {
    const timerId = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(timerId);
  }, []);

  useEffect(() => {
    const context = readEventControlContext();
    if (context.organisationId) setOrganisationId(context.organisationId);
    if (context.eventId) setEventId(context.eventId);
    setContextHydrated(true);
  }, []);

  useEffect(() => {
    if (!contextHydrated || !organisationId.trim() || !eventId.trim()) return;
    void load();
  }, [contextHydrated]);

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
  const payment = snapshot ? paymentState(snapshot) : null;
  const devices = snapshot ? deviceState(snapshot) : null;
  const criticalRiskCount =
    snapshot?.inventory.risks.filter((risk) => risk.severity.toUpperCase() === 'CRITICAL').length ??
    0;
  const inventoryTone: Tone = !snapshot
    ? 'neutral'
    : criticalRiskCount > 0
      ? 'danger'
      : snapshot.inventory.risks.length > 0
        ? 'warning'
        : 'success';

  return (
    <main className="ec-page ec-page--wide ec-command-centre-page">
      <header className="ec-live-header">
        <div>
          <p className="ec-page-kicker">Live operations</p>
          <div className="ec-live-title-row">
            <h1 className="ec-live-title">{snapshot?.event.name ?? 'Event command centre'}</h1>
            <StatusPill mode={mode} stale={stale} />
          </div>
          <p className="ec-live-description">
            {snapshot
              ? `${snapshot.event.timezone} · ${new Date(snapshot.event.startsAt).toLocaleString()} — ${new Date(snapshot.event.endsAt).toLocaleString()}`
              : 'Load an event to see exceptions, sales, inventory, payments and register health in one operating view.'}
          </p>
          {snapshot ? (
            <div className="ec-live-meta">
              <span>Snapshot {ageLabel(snapshot.freshness.generatedAt, now)}</span>
              <span aria-hidden="true">•</span>
              <span>Last sale {formatTime(snapshot.sales.lastSaleAt)}</span>
            </div>
          ) : null}
        </div>
      </header>

      <div className="ec-operations-stack" aria-busy={loadingContext || busyAlertId !== null}>
        {snapshot ? (
          <details className="ec-context-switcher">
            <summary>Change event context</summary>
            <form
              className="ec-context-loader ec-context-loader--embedded"
              onSubmit={(event) => {
                event.preventDefault();
                void load();
              }}
            >
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
              <button type="submit" className="ec-button-primary" disabled={loadingContext}>
                {loadingContext ? 'Loading…' : 'Load event'}
              </button>
            </form>
          </details>
        ) : (
          <section className="ec-context-card">
            <div>
              <strong>Select event context</strong>
              <p>
                The event selected elsewhere in Event Control loads automatically. Enter different
                IDs here only when you need to switch context or retry a failed load.
              </p>
            </div>
            <form
              className="ec-context-loader"
              onSubmit={(event) => {
                event.preventDefault();
                void load();
              }}
            >
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
              <button type="submit" className="ec-button-primary" disabled={loadingContext}>
                {loadingContext ? 'Loading live event…' : 'Load live event'}
              </button>
            </form>
          </section>
        )}

        {error ? <div className="ec-banner ec-banner--warning">{error}</div> : null}

        {snapshot && stale ? (
          <div className="ec-banner ec-banner--danger">
            <strong>Do not treat this screen as current truth.</strong> Live streaming is
            unavailable or this snapshot is old. Local POS selling can continue; investigate
            connectivity before acting on dashboard timing alone.
          </div>
        ) : null}

        {snapshot ? (
          <>
            <LifecycleTrack current={snapshot.event.lifecycle} />

            <div className="ec-health-row" aria-label="System health summary">
              <StatusChip
                tone={payment?.tone ?? 'neutral'}
                label={`Payments · ${payment?.label ?? '—'}`}
              />
              <StatusChip
                tone={devices?.tone ?? 'neutral'}
                label={
                  snapshot.devices.length === 0
                    ? 'Sync · no devices yet'
                    : devices?.issues === 0
                      ? 'Sync · all devices healthy'
                      : `Sync · ${devices?.issues ?? 0} device issue(s)`
                }
              />
              <StatusChip
                tone={inventoryTone}
                label={
                  snapshot.inventory.risks.length === 0
                    ? 'Inventory · no active risk'
                    : `Inventory · ${snapshot.inventory.risks.length} at risk`
                }
              />
              <StatusChip
                tone={
                  criticalAlertCount > 0
                    ? 'danger'
                    : snapshot.alerts.length > 0
                      ? 'warning'
                      : 'success'
                }
                label={
                  snapshot.alerts.length === 0
                    ? 'Alerts · all clear'
                    : `Alerts · ${snapshot.alerts.length} active`
                }
              />
              <StatusChip tone="success" label="Local-first POS protected" />
            </div>

            <section className="ec-kpi-strip" aria-label="Event operating snapshot">
              <Metric
                label="Gross sales"
                value={moneyList(snapshot.sales.grossSales)}
                sub={`Velocity ${velocityList(snapshot.sales.currentSalesVelocity)}`}
              />
              <Metric
                label="Transactions"
                value={snapshot.sales.transactionCount.toLocaleString()}
                sub={`Average order ${averageList(snapshot.sales.averageOrderValue)}`}
              />
              <Metric
                label="At-risk SKUs"
                value={snapshot.inventory.risks.length}
                sub={
                  criticalRiskCount > 0 ? `${criticalRiskCount} critical` : 'No critical stock risk'
                }
                tone={inventoryTone}
              />
              <Metric
                label="Device issues"
                value={devices?.issues ?? 0}
                sub={`${devices?.degraded ?? 0} degraded · ${devices?.stale ?? 0} stale`}
                tone={devices?.tone ?? 'neutral'}
              />
              <Metric
                label="Active alerts"
                value={snapshot.alerts.length}
                sub={
                  criticalAlertCount > 0 ? `${criticalAlertCount} critical` : 'No critical alerts'
                }
                tone={
                  criticalAlertCount > 0
                    ? 'danger'
                    : snapshot.alerts.length > 0
                      ? 'warning'
                      : 'success'
                }
              />
              <Metric
                label="Data freshness"
                value={
                  stale
                    ? 'Stale'
                    : mode === 'LIVE'
                      ? 'Live'
                      : mode === 'POLLING'
                        ? 'Polling'
                        : 'Connecting'
                }
                sub={`Snapshot ${ageLabel(snapshot.freshness.generatedAt, now)}`}
                tone={stale ? 'danger' : mode === 'LIVE' ? 'success' : 'warning'}
              />
            </section>

            {snapshot.alerts.length > 0 ||
            snapshot.inventory.risks.length > 0 ||
            (devices?.issues ?? 0) > 0 ? (
              <div
                className="ec-exception-strip"
                data-tone={criticalAlertCount > 0 ? 'danger' : 'warning'}
              >
                <span className="ec-exception-icon" aria-hidden="true">
                  !
                </span>
                <div>
                  <strong>Attention required</strong>
                  <span>
                    {snapshot.alerts.length} active alert(s) · {snapshot.inventory.risks.length}{' '}
                    inventory risk(s) · {devices?.issues ?? 0} device issue(s)
                  </span>
                </div>
              </div>
            ) : (
              <div className="ec-exception-strip" data-tone="success">
                <span className="ec-exception-icon" aria-hidden="true">
                  ✓
                </span>
                <div>
                  <strong>All clear</strong>
                  <span>
                    No active alerts, inventory risks or device health exceptions are projected.
                  </span>
                </div>
              </div>
            )}

            <div className="ec-live-grid">
              <div className="ec-live-main">
                <Panel
                  title="Sales performance"
                  meta="Closed event orders, current velocity and location performance"
                  action={
                    <span className="ec-panel-meta">
                      Last sale {formatTime(snapshot.sales.lastSaleAt)}
                    </span>
                  }
                >
                  <div className="ec-inline-metrics">
                    <div>
                      <small>Current velocity</small>
                      <strong>{velocityList(snapshot.sales.currentSalesVelocity)}</strong>
                    </div>
                    <div>
                      <small>Average order</small>
                      <strong>{averageList(snapshot.sales.averageOrderValue)}</strong>
                    </div>
                    <div>
                      <small>Active sales locations</small>
                      <strong>{snapshot.salesLocations.length}</strong>
                    </div>
                  </div>
                  {snapshot.salesLocations.length === 0 ? (
                    <p className="ec-empty">No closed sales yet.</p>
                  ) : (
                    <div className="ec-compact-list">
                      {snapshot.salesLocations.map((location) => (
                        <div className="ec-compact-row" key={location.salesLocationId}>
                          <div>
                            <strong>{location.name}</strong>
                            <small>Last sale {formatTime(location.lastSaleAt)}</small>
                          </div>
                          <div className="ec-compact-row-value">
                            <strong>{moneyList(location.grossSales)}</strong>
                            <small>
                              {location.transactionCount} txn ·{' '}
                              {velocityList(location.currentSalesVelocity)}
                            </small>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Panel>

                <Panel
                  title="Inventory risk"
                  meta="Products requiring the earliest operational response"
                  action={
                    <Link className="ec-panel-link" href="/inventory">
                      View inventory →
                    </Link>
                  }
                >
                  {snapshot.inventory.risks.length === 0 ? (
                    <div className="ec-empty-state" data-tone="success">
                      No active inventory risks.
                    </div>
                  ) : (
                    <div className="ec-risk-list">
                      {snapshot.inventory.risks.slice(0, 10).map((risk) => {
                        const riskTone: Tone =
                          risk.severity.toUpperCase() === 'CRITICAL' ? 'danger' : 'warning';
                        return (
                          <div className="ec-risk-row" key={risk.alertId}>
                            <span className="ec-risk-severity" data-tone={riskTone}>
                              {risk.severity}
                            </span>
                            <div className="ec-risk-copy">
                              <strong>{risk.skuName}</strong>
                              <span>
                                {risk.inventoryLocationName ?? 'Event-wide'} ·{' '}
                                {risk.availableQuantityBase} available
                              </span>
                              {risk.suggestedTransferQuantityBase ? (
                                <small>
                                  Suggested transfer {risk.suggestedTransferQuantityBase} from{' '}
                                  {risk.suggestedSourceLocationName ??
                                    risk.suggestedSourceLocationId ??
                                    'best source'}
                                </small>
                              ) : null}
                            </div>
                            <div className="ec-risk-cover" data-tone={riskTone}>
                              <strong>{risk.minutesOfCover ?? '—'}</strong>
                              <small>min cover</small>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Panel>

                <Panel
                  title="Device health"
                  meta="Register heartbeat, backlog and locally committed sales visibility"
                  action={
                    <Link className="ec-panel-link" href="/sync-health">
                      View devices →
                    </Link>
                  }
                >
                  <div className="ec-device-summary">
                    <div data-tone="success">
                      <strong>{devices?.healthy ?? 0}</strong>
                      <span>Healthy</span>
                    </div>
                    <div data-tone="warning">
                      <strong>{devices?.degraded ?? 0}</strong>
                      <span>Degraded</span>
                    </div>
                    <div data-tone="danger">
                      <strong>{devices?.stale ?? 0}</strong>
                      <span>Stale</span>
                    </div>
                    <div>
                      <strong>
                        {snapshot.devices.reduce((sum, device) => sum + device.edgeBacklogCount, 0)}
                      </strong>
                      <span>Total backlog</span>
                    </div>
                  </div>
                  {snapshot.devices.length === 0 ? (
                    <p className="ec-empty">No event devices observed yet.</p>
                  ) : (
                    <div className="ec-compact-list">
                      {snapshot.devices
                        .slice()
                        .sort((left, right) => {
                          const order = { STALE: 0, DEGRADED: 1, HEALTHY: 2 } as const;
                          return order[left.status] - order[right.status];
                        })
                        .slice(0, 12)
                        .map((device) => (
                          <div className="ec-compact-row" key={device.deviceId}>
                            <div className="ec-device-name">
                              <span
                                className="ec-system-dot"
                                data-tone={
                                  device.status === 'STALE'
                                    ? 'danger'
                                    : device.status === 'DEGRADED'
                                      ? 'warning'
                                      : 'success'
                                }
                                aria-hidden="true"
                              />
                              <span>
                                <strong>{device.deviceId}</strong>
                                <small>{device.salesLocationName ?? 'Unknown location'}</small>
                              </span>
                            </div>
                            <div className="ec-compact-row-value">
                              <strong>{device.status}</strong>
                              <small>
                                backlog {device.edgeBacklogCount} ·{' '}
                                {device.syncAgeSeconds === null
                                  ? 'no heartbeat'
                                  : `${device.syncAgeSeconds}s sync age`}
                              </small>
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </Panel>

                <div className="ec-two-panel-grid">
                  <Panel title="Top products" meta="Current closed-order sales mix">
                    {snapshot.topProducts.length === 0 ? (
                      <p className="ec-empty">No product sales yet.</p>
                    ) : null}
                    <div className="ec-compact-list">
                      {snapshot.topProducts.slice(0, 10).map((product) => (
                        <div className="ec-compact-row" key={product.skuId}>
                          <div>
                            <strong>{product.name}</strong>
                            <small>{product.quantitySold} sold</small>
                          </div>
                          <div className="ec-compact-row-value">
                            <strong>{moneyList(product.grossSales)}</strong>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Panel>
                  <Panel title="Active transfers" meta="Stock in motion until receipt is recorded">
                    {snapshot.inventory.activeTransfers.length === 0 ? (
                      <p className="ec-empty">No active transfers.</p>
                    ) : null}
                    <div className="ec-compact-list">
                      {snapshot.inventory.activeTransfers.map((transfer) => (
                        <div className="ec-transfer-row" key={transfer.transferId}>
                          <span className="ec-status-pill" data-tone="warning">
                            {transfer.state}
                          </span>
                          <strong>
                            {transfer.sourceLocationName ?? transfer.sourceLocationId} →{' '}
                            {transfer.destinationLocationName ?? transfer.destinationLocationId}
                          </strong>
                          <small>Updated {formatTime(transfer.updatedAt)}</small>
                        </div>
                      ))}
                    </div>
                  </Panel>
                </div>
              </div>

              <aside className="ec-live-rail">
                <Panel
                  title="System status"
                  meta={`Snapshot ${ageLabel(snapshot.freshness.generatedAt, now)}`}
                >
                  <div className="ec-system-list">
                    <SystemStatusRow
                      label="Payments"
                      value={payment?.label ?? '—'}
                      detail={payment?.detail ?? 'No payment data'}
                      tone={payment?.tone ?? 'neutral'}
                    />
                    <SystemStatusRow
                      label="Sync"
                      value={
                        snapshot.devices.length === 0
                          ? 'No devices'
                          : devices?.issues === 0
                            ? 'Healthy'
                            : `${devices?.issues ?? 0} issues`
                      }
                      detail={`${devices?.healthy ?? 0} healthy · ${devices?.degraded ?? 0} degraded · ${devices?.stale ?? 0} stale`}
                      tone={devices?.tone ?? 'neutral'}
                    />
                    <SystemStatusRow
                      label="Inventory"
                      value={
                        snapshot.inventory.risks.length === 0
                          ? 'Healthy'
                          : `${snapshot.inventory.risks.length} at risk`
                      }
                      detail={
                        criticalRiskCount > 0
                          ? `${criticalRiskCount} critical risk(s)`
                          : 'No critical stock risk'
                      }
                      tone={inventoryTone}
                    />
                    <SystemStatusRow
                      label="Realtime"
                      value={
                        stale
                          ? 'Stale'
                          : mode === 'LIVE'
                            ? 'Live'
                            : mode === 'POLLING'
                              ? 'Polling'
                              : 'Connecting'
                      }
                      detail={`Generated ${ageLabel(snapshot.freshness.generatedAt, now)}`}
                      tone={stale ? 'danger' : mode === 'LIVE' ? 'success' : 'warning'}
                    />
                  </div>
                </Panel>

                <Panel title="Active alerts" meta={`${snapshot.alerts.length} requiring attention`}>
                  {snapshot.alerts.length === 0 ? (
                    <div className="ec-empty-state" data-tone="success">
                      No active operational exceptions.
                    </div>
                  ) : (
                    <div className="ec-action-list">
                      {snapshot.alerts.map((alert) => (
                        <AlertCard
                          key={alert.id}
                          alert={alert}
                          busy={busyAlertId === alert.inventoryAlertId}
                          onAcknowledge={() => {
                            if (alert.inventoryAlertId)
                              void act(alert.inventoryAlertId, 'ACKNOWLEDGE');
                          }}
                          onAssign={() => {
                            if (alert.inventoryAlertId) void act(alert.inventoryAlertId, 'ASSIGN');
                          }}
                        />
                      ))}
                    </div>
                  )}
                </Panel>

                <Panel title="Payment health" meta="Do not retry unknown payments">
                  <div className="ec-payment-health">
                    <div>
                      <span>Pending</span>
                      <strong>{snapshot.payments.attempts.pendingCount}</strong>
                      <small>{(snapshot.payments.attempts.pendingRate * 100).toFixed(1)}%</small>
                    </div>
                    <div
                      data-tone={snapshot.payments.attempts.unknownCount > 0 ? 'danger' : 'neutral'}
                    >
                      <span>Unknown</span>
                      <strong>{snapshot.payments.attempts.unknownCount}</strong>
                      <small>{(snapshot.payments.attempts.unknownRate * 100).toFixed(1)}%</small>
                    </div>
                    <div>
                      <span>Failed</span>
                      <strong>{snapshot.payments.attempts.failedCount}</strong>
                      <small>{(snapshot.payments.attempts.failureRate * 100).toFixed(1)}%</small>
                    </div>
                  </div>
                  {snapshot.payments.attempts.unknownCount > 0 ? (
                    <div className="ec-payment-unknown">
                      Unknown value:{' '}
                      <strong>{moneyList(snapshot.payments.attempts.unknownValue)}</strong>
                    </div>
                  ) : null}
                  <div className="ec-rail-list">
                    {snapshot.payments.rails.map((rail) => (
                      <div key={rail.providerId}>
                        <span
                          className="ec-system-dot"
                          data-tone={
                            rail.status === 'AVAILABLE'
                              ? 'success'
                              : rail.status === 'DEGRADED'
                                ? 'warning'
                                : 'neutral'
                          }
                          aria-hidden="true"
                        />
                        <span>
                          <strong>{rail.providerId}</strong>
                          <small>{rail.detailCode ?? rail.status}</small>
                        </span>
                        <b>{rail.status}</b>
                      </div>
                    ))}
                  </div>
                </Panel>
              </aside>
            </div>
          </>
        ) : null}
      </div>
    </main>
  );
}
