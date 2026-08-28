'use client';

import type {
  CommandCentreAlert,
  CommandCentreCurrencyAmount,
  CommandCentreCurrencyAverage,
  CommandCentreCurrencyVelocity,
  CommandCentreInventoryRisk,
  CommandCentreSnapshot,
} from '@event-commerce/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { eventControlContextChangedEvent, readEventControlContext } from '../event-context';
import { OperatorContextSwitcher } from '../operator-context-switcher';
import {
  COMMAND_CENTRE_POLL_INTERVAL_MS,
  nextRealtimeMode,
  snapshotIsStale,
  type CommandCentreRealtimeMode,
} from './command-centre-state';

const apiBase = process.env.NEXT_PUBLIC_CLOUD_API_URL ?? 'http://localhost:3001';

type ActiveEvent = { organisationId: string; eventId: string };
type PulseWindow = '15m' | '30m' | '60m' | 'event';
type Tone = 'success' | 'warning' | 'danger' | 'neutral';

function requestHeaders(organisationId: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-event-control-request': 'browser',
    'x-organisation-id': organisationId,
  };
}

async function commandCentreRequest<T>(
  path: string,
  organisationId: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(requestHeaders(organisationId));
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers,
    credentials: 'include',
    cache: 'no-store',
  });
  if (response.status === 401) throw new Error('Session expired. Sign in again.');
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
}

function formatMinor(currency: string, amountMinor: string, fractionDigits = 0): string {
  const amount = Number(amountMinor) / 100;
  if (!Number.isFinite(amount)) return `${currency} ${amountMinor}`;
  try {
    return new Intl.NumberFormat('en-KE', {
      style: 'currency',
      currency,
      maximumFractionDigits: fractionDigits,
      minimumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(fractionDigits)}`;
  }
}

function moneyList(values: CommandCentreCurrencyAmount[], compact = false): string {
  if (values.length === 0) return '—';
  return values
    .map((value) =>
      compact
        ? compactMoney(value.currency, value.amountMinor)
        : formatMinor(value.currency, value.amountMinor),
    )
    .join(' · ');
}

function compactMoney(currency: string, amountMinor: string): string {
  const amount = Number(amountMinor) / 100;
  if (!Number.isFinite(amount)) return formatMinor(currency, amountMinor);
  try {
    return new Intl.NumberFormat('en-KE', {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(amount);
  } catch {
    return formatMinor(currency, amountMinor);
  }
}

function averageList(values: CommandCentreCurrencyAverage[]): string {
  return values.length === 0
    ? '—'
    : values.map((value) => formatMinor(value.currency, value.averageOrderValueMinor)).join(' · ');
}

function velocityList(values: CommandCentreCurrencyVelocity[]): string {
  return values.length === 0
    ? '—'
    : values
        .map((value) => `${formatMinor(value.currency, value.amountMinorPerMinute)}/min`)
        .join(' · ');
}

function amountTotal(values: CommandCentreCurrencyAmount[]): bigint {
  return values.reduce((sum, value) => sum + BigInt(value.amountMinor), 0n);
}

function primaryAmount(values: CommandCentreCurrencyAmount[]): CommandCentreCurrencyAmount | null {
  return values[0] ?? null;
}

function ageLabel(value: string | null, now: number): string {
  if (!value) return 'not reported';
  const seconds = Math.max(0, Math.floor((now - Date.parse(value)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ago`;
}

function durationLabel(milliseconds: number): string {
  const totalMinutes = Math.max(0, Math.floor(milliseconds / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
}

function eventPhase(
  snapshot: CommandCentreSnapshot,
  now: number,
): {
  label: string;
  tone: Tone;
  progress: number;
  timing: string;
} {
  const start = Date.parse(snapshot.event.startsAt);
  const end = Date.parse(snapshot.event.endsAt);
  if (snapshot.event.lifecycle === 'CLOSED') {
    return { label: 'CLOSED', tone: 'neutral', progress: 1, timing: 'Trading closed' };
  }
  if (now < start) {
    return {
      label: 'READY',
      tone: 'neutral',
      progress: 0,
      timing: `Starts in ${durationLabel(start - now)}`,
    };
  }
  const progress = Math.max(0, Math.min(1, (now - start) / Math.max(1, end - start)));
  if (now <= end) {
    return {
      label: 'LIVE',
      tone: 'success',
      progress,
      timing: `${durationLabel(now - start)} elapsed · ${durationLabel(end - now)} remaining`,
    };
  }
  return {
    label: 'AWAITING CLOSE',
    tone: 'warning',
    progress: 1,
    timing: `Ended ${durationLabel(now - end)} ago`,
  };
}

function severityTone(severity: string): Tone {
  if (severity === 'CRITICAL') return 'danger';
  if (severity === 'URGENT' || severity === 'WARNING') return 'warning';
  return 'neutral';
}

function severityLabel(severity: string): string {
  if (severity === 'CRITICAL') return 'Critical';
  if (severity === 'URGENT') return 'Urgent';
  if (severity === 'WARNING') return 'Watch';
  return 'Information';
}

function plainInventoryTitle(risk: CommandCentreInventoryRisk): string {
  if (risk.alertType.includes('STOCKOUT')) return `${risk.skuName} may run out`;
  if (risk.alertType === 'LOW_STOCK') return `${risk.skuName} is running low`;
  if (risk.alertType === 'ABNORMAL_DEPLETION')
    return `${risk.skuName} is selling faster than expected`;
  if (risk.alertType === 'STOCK_IMBALANCE') return `${risk.skuName} stock is imbalanced`;
  return `${risk.skuName} needs stock attention`;
}

function coverLabel(value: string | null): string {
  if (!value) return 'Cover unknown';
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return 'Cover unknown';
  return `${Math.max(0, Math.round(minutes))} min cover`;
}

function quantityLabel(value: string | null): string {
  if (!value) return '—';
  const quantity = Number(value);
  if (!Number.isFinite(quantity)) return value;
  return new Intl.NumberFormat('en-KE', {
    maximumFractionDigits: Number.isInteger(quantity) ? 0 : 1,
  }).format(quantity);
}

function friendlyDeviceLabels(snapshot: CommandCentreSnapshot): Map<string, string> {
  const groups = new Map<string, typeof snapshot.devices>();
  for (const device of snapshot.devices) {
    const key = device.salesLocationName ?? 'Unassigned';
    const current = groups.get(key) ?? [];
    current.push(device);
    groups.set(key, current);
  }
  const labels = new Map<string, string>();
  for (const [location, devices] of groups) {
    [...devices]
      .sort((a, b) => a.deviceId.localeCompare(b.deviceId))
      .forEach((device, index) => {
        labels.set(device.deviceId, `${location} Till ${String(index + 1).padStart(2, '0')}`);
      });
  }
  return labels;
}

function actionPresentation(
  alert: CommandCentreAlert,
  snapshot: CommandCentreSnapshot,
  deviceLabels: Map<string, string>,
): {
  title: string;
  context: string;
  actionHref: string;
  actionLabel: string;
  risk: CommandCentreInventoryRisk | null;
} {
  if (alert.source === 'INVENTORY') {
    const risk =
      snapshot.inventory.risks.find((candidate) => candidate.alertId === alert.inventoryAlertId) ??
      null;
    if (risk) {
      const move =
        risk.suggestedTransferQuantityBase && risk.suggestedSourceLocationName
          ? `Move ${quantityLabel(risk.suggestedTransferQuantityBase)} from ${risk.suggestedSourceLocationName}`
          : 'Review stock position';
      return {
        title: plainInventoryTitle(risk),
        context: `${risk.inventoryLocationName ?? 'Event-wide'} · ${coverLabel(risk.minutesOfCover)} · ${move}`,
        actionHref: '/inventory',
        actionLabel: 'View stock',
        risk,
      };
    }
  }
  if (alert.source === 'PAYMENT') {
    return {
      title:
        alert.id === 'payment:unknown'
          ? `${snapshot.payments.attempts.unknownCount} payments need verification`
          : alert.id === 'payment:pending'
            ? `${snapshot.payments.attempts.pendingCount} payments are still pending`
            : 'Payment configuration needs attention',
      context:
        alert.id === 'payment:unknown'
          ? `${moneyList(snapshot.payments.attempts.unknownValue)} unresolved`
          : alert.detail,
      actionHref: '/event-close',
      actionLabel: 'Open reconciliation',
      risk: null,
    };
  }
  const deviceId = alert.id.startsWith('device:') ? alert.id.slice('device:'.length) : '';
  const device = snapshot.devices.find((candidate) => candidate.deviceId === deviceId);
  return {
    title: device
      ? `${deviceLabels.get(device.deviceId) ?? 'Till'} ${device.status === 'STALE' ? 'is not reporting' : 'is reporting late'}`
      : alert.title,
    context: device
      ? `${device.edgeBacklogCount} queued sale update${device.edgeBacklogCount === 1 ? '' : 's'} · last heartbeat ${ageLabel(device.lastSeenAt, Date.now())}`
      : alert.detail,
    actionHref: '/sync-health',
    actionLabel: 'Diagnose till',
    risk: null,
  };
}

function windowMinutes(value: PulseWindow): number | null {
  if (value === '15m') return 15;
  if (value === '30m') return 30;
  if (value === '60m') return 60;
  return null;
}

function currentOrderRate(snapshot: CommandCentreSnapshot, now: number): number {
  const count = snapshot.salesPulse
    .filter((point) => Date.parse(point.bucketStart) >= now - 15 * 60_000)
    .reduce((sum, point) => sum + point.transactionCount, 0);
  return count / 15;
}

function SalesPulseChart({
  snapshot,
  window,
  now,
}: {
  snapshot: CommandCentreSnapshot;
  window: PulseWindow;
  now: number;
}) {
  const minutes = windowMinutes(window);
  const points = snapshot.salesPulse.filter(
    (point) => minutes === null || Date.parse(point.bucketStart) >= now - minutes * 60_000,
  );
  const prepared = points.map((point) => ({
    ...point,
    grossMinor: Number(primaryAmount(point.grossSales)?.amountMinor ?? '0'),
  }));
  if (prepared.length === 0) {
    return (
      <div className="ec-live-empty">
        <strong>No completed orders in this window.</strong>
        <span>The chart will populate as sales reach Cloud.</span>
      </div>
    );
  }

  const width = 760;
  const height = 250;
  const left = 18;
  const right = 12;
  const top = 12;
  const bottom = 38;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxGross = Math.max(...prepared.map((point) => point.grossMinor), 1);
  const maxOrders = Math.max(...prepared.map((point) => point.transactionCount), 1);
  const x = (index: number) =>
    left + (prepared.length === 1 ? plotWidth / 2 : (index / (prepared.length - 1)) * plotWidth);
  const y = (grossMinor: number) => top + plotHeight - (grossMinor / maxGross) * plotHeight;
  const line = prepared.map((point, index) => `${x(index)},${y(point.grossMinor)}`).join(' ');
  const area = [
    `M ${x(0)} ${top + plotHeight}`,
    ...prepared.map((point, index) => `L ${x(index)} ${y(point.grossMinor)}`),
    `L ${x(prepared.length - 1)} ${top + plotHeight} Z`,
  ].join(' ');
  const labels = [0, Math.floor((prepared.length - 1) / 2), prepared.length - 1]
    .filter((value, index, all) => all.indexOf(value) === index)
    .map((index) => ({
      index,
      label: new Date(prepared[index]!.bucketStart).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
    }));

  return (
    <div className="ec-pulse-chart-wrap">
      <svg
        className="ec-pulse-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Five-minute sales pulse, with revenue line and completed-order bars"
      >
        <line
          className="ec-chart-grid"
          x1={left}
          x2={width - right}
          y1={top + plotHeight}
          y2={top + plotHeight}
        />
        <line
          className="ec-chart-grid"
          x1={left}
          x2={width - right}
          y1={top + plotHeight / 2}
          y2={top + plotHeight / 2}
        />
        {prepared.map((point, index) => {
          const barHeight = Math.max(2, (point.transactionCount / maxOrders) * plotHeight * 0.36);
          const barWidth = Math.max(3, Math.min(16, plotWidth / Math.max(1, prepared.length) - 3));
          return (
            <rect
              className="ec-chart-order-bar"
              key={point.bucketStart}
              x={x(index) - barWidth / 2}
              y={top + plotHeight - barHeight}
              width={barWidth}
              height={barHeight}
              rx="2"
            />
          );
        })}
        <path className="ec-chart-area" d={area} />
        <polyline className="ec-chart-line" points={line} fill="none" />
        {prepared.map((point, index) => (
          <circle
            className="ec-chart-point"
            key={`point:${point.bucketStart}`}
            cx={x(index)}
            cy={y(point.grossMinor)}
            r="2.5"
          />
        ))}
        {labels.map(({ index, label }) => (
          <text
            className="ec-chart-label"
            key={`label:${index}`}
            x={x(index)}
            y={height - 10}
            textAnchor="middle"
          >
            {label}
          </text>
        ))}
      </svg>
      <div className="ec-chart-legend">
        <span>
          <i className="ec-legend-line" /> Revenue per 5 min
        </span>
        <span>
          <i className="ec-legend-bar" /> Completed orders
        </span>
      </div>
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
  const [organisationId, setOrganisationId] = useState('');
  const [eventId, setEventId] = useState('');
  const [active, setActive] = useState<ActiveEvent | null>(null);
  const [snapshot, setSnapshot] = useState<CommandCentreSnapshot | null>(null);
  const [mode, setMode] = useState<CommandCentreRealtimeMode>('IDLE');
  const [error, setError] = useState<string | null>(null);
  const [contextHydrated, setContextHydrated] = useState(false);
  const [busyAlertId, setBusyAlertId] = useState<string | null>(null);
  const [pulseWindow, setPulseWindow] = useState<PulseWindow>('60m');
  const [now, setNow] = useState(() => Date.now());

  const fetchSnapshot = useCallback(async (target: ActiveEvent) => {
    const next = await commandCentreRequest<CommandCentreSnapshot>(
      `/command-centre/events/${encodeURIComponent(target.eventId)}`,
      target.organisationId,
    );
    setSnapshot(next);
    setError(null);
  }, []);

  useEffect(() => {
    const syncContext = () => {
      const context = readEventControlContext();
      setOrganisationId(context.organisationId ?? '');
      setEventId(context.eventId ?? '');
      setActive(null);
      setSnapshot(null);
      setMode('IDLE');
      setError(null);
      setContextHydrated(true);
    };
    syncContext();
    window.addEventListener(eventControlContextChangedEvent, syncContext);
    return () => window.removeEventListener(eventControlContextChangedEvent, syncContext);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!contextHydrated || !organisationId || !eventId) return;
    const target = { organisationId, eventId };
    void fetchSnapshot(target)
      .then(() => {
        setActive(target);
        setMode((current) => nextRealtimeMode(current, 'CONNECT'));
      })
      .catch((failure) => {
        setError(failure instanceof Error ? failure.message : 'Unable to load Command Centre');
      });
  }, [contextHydrated, organisationId, eventId, fetchSnapshot]);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setMode((current) => nextRealtimeMode(current, 'CONNECT'));
    void (async () => {
      try {
        const response = await fetch(
          `${apiBase}/command-centre/events/${encodeURIComponent(active.eventId)}/stream`,
          {
            headers: requestHeaders(active.organisationId),
            credentials: 'include',
            cache: 'no-store',
            signal: controller.signal,
          },
        );
        if (!response.ok) throw new Error(`Realtime channel returned ${response.status}`);
        setMode((current) => nextRealtimeMode(current, 'STREAM_CONNECTED'));
        await consumeSse(response, async () => fetchSnapshot(active));
      } catch {
        if (controller.signal.aborted) return;
        setMode((current) => nextRealtimeMode(current, 'STREAM_FAILED'));
      }
    })();
    return () => controller.abort();
  }, [active, fetchSnapshot]);

  useEffect(() => {
    if (!active || mode !== 'POLLING') return;
    const timer = window.setInterval(
      () => void fetchSnapshot(active).catch(() => undefined),
      COMMAND_CENTRE_POLL_INTERVAL_MS,
    );
    return () => window.clearInterval(timer);
  }, [active, mode, fetchSnapshot]);

  async function actOnInventoryAlert(
    risk: CommandCentreInventoryRisk,
    action: 'ACKNOWLEDGE' | 'ASSIGN',
  ) {
    if (!active) return;
    setBusyAlertId(risk.alertId);
    try {
      await commandCentreRequest(
        `/command-centre/events/${encodeURIComponent(active.eventId)}/inventory-alerts/${encodeURIComponent(risk.alertId)}/actions`,
        active.organisationId,
        { method: 'POST', body: JSON.stringify({ action }) },
      );
      await fetchSnapshot(active);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to update incident');
    } finally {
      setBusyAlertId(null);
    }
  }

  const deviceLabels = useMemo(
    () => (snapshot ? friendlyDeviceLabels(snapshot) : new Map<string, string>()),
    [snapshot],
  );

  if (!organisationId || !eventId) {
    return (
      <main className="ec-page ec-page--wide ec-live-command-centre">
        <section className="ec-live-selector-empty">
          <p className="ec-live-kicker">Command Centre</p>
          <h1>Select the event you want to run.</h1>
          <p>Live trading, payment, stock and till truth will appear here.</p>
          <OperatorContextSwitcher />
        </section>
      </main>
    );
  }

  if (!snapshot) {
    return (
      <main className="ec-page ec-page--wide ec-live-command-centre">
        <section className="ec-live-selector-empty" aria-live="polite">
          <p className="ec-live-kicker">Command Centre</p>
          <h1>{error ? 'Command Centre unavailable.' : 'Loading live event truth…'}</h1>
          <p>{error ?? 'Preparing trading, payment, stock and till signals.'}</p>
          {error ? (
            <div className="ec-live-empty-actions">
              <button
                type="button"
                onClick={() =>
                  void fetchSnapshot({ organisationId, eventId })
                    .then(() => setActive({ organisationId, eventId }))
                    .catch((failure) =>
                      setError(failure instanceof Error ? failure.message : 'Unable to reload'),
                    )
                }
              >
                Retry
              </button>
              {error.startsWith('Session expired') ? (
                <Link href="/sign-in">Sign in again</Link>
              ) : null}
            </div>
          ) : null}
        </section>
      </main>
    );
  }

  const phase = eventPhase(snapshot, now);
  const stale = snapshotIsStale(snapshot, now);
  const payment = snapshot.payments.attempts;
  const deviceIssues = snapshot.devices.filter((device) => device.status !== 'HEALTHY');
  const reportingDevices = snapshot.devices.filter((device) => device.status !== 'STALE').length;
  const queuedUploads = snapshot.devices.reduce((sum, device) => sum + device.edgeBacklogCount, 0);
  const criticalRisks = snapshot.inventory.risks.filter((risk) => risk.severity === 'CRITICAL');
  const warningRisks = snapshot.inventory.risks.filter((risk) => risk.severity !== 'CRITICAL');
  const configurationAlerts = snapshot.alerts.filter((alert) =>
    alert.id.startsWith('payment-rail:'),
  );
  const liveActionAlerts = snapshot.alerts.filter((alert) => !alert.id.startsWith('payment-rail:'));
  const actionAlerts = liveActionAlerts.slice(0, 5);
  const primaryGross = primaryAmount(snapshot.sales.grossSales);
  const lastSaleLocation =
    [...snapshot.salesLocations]
      .filter((location) => location.lastSaleAt)
      .sort((a, b) => (b.lastSaleAt ?? '').localeCompare(a.lastSaleAt ?? ''))[0]?.name ?? '—';

  return (
    <main className="ec-page ec-page--wide ec-live-command-centre">
      <section className="ec-event-spine">
        <div className="ec-event-spine-main">
          <div>
            <p className="ec-live-kicker">Command Centre</p>
            <div className="ec-event-title-row">
              <h1>{snapshot.event.name}</h1>
              <span className="ec-live-phase" data-tone={phase.tone}>
                <span aria-hidden="true" />
                {phase.label}
              </span>
            </div>
            <p className="ec-event-timing">{phase.timing}</p>
          </div>
          <div className="ec-event-switcher">
            <OperatorContextSwitcher />
          </div>
        </div>

        <div
          className="ec-event-progress"
          aria-label={`Event progress ${Math.round(phase.progress * 100)}%`}
        >
          <div className="ec-event-progress-track">
            <span style={{ width: `${phase.progress * 100}%` }} />
            <i style={{ left: `${phase.progress * 100}%` }} aria-hidden="true" />
          </div>
          <div className="ec-event-progress-labels">
            <span>Open</span>
            <strong>Now</strong>
            <span>Close</span>
          </div>
        </div>

        <div className="ec-truth-bar">
          <div className="ec-truth-block">
            <span className="ec-truth-label">Venue Edge</span>
            <strong>
              <i data-tone="success" /> Local selling protected from Cloud loss
            </strong>
          </div>
          <div className="ec-sync-trace" aria-hidden="true">
            <span />
          </div>
          <div className="ec-truth-block">
            <span className="ec-truth-label">Cloud mirror</span>
            <strong>
              <i data-tone={stale ? 'warning' : 'success'} />
              {stale
                ? `Data delayed · generated ${ageLabel(snapshot.freshness.generatedAt, now)}`
                : `Updated ${ageLabel(snapshot.freshness.generatedAt, now)}`}
            </strong>
          </div>
          <div className="ec-truth-meta">Last sale {ageLabel(snapshot.sales.lastSaleAt, now)}</div>
        </div>
      </section>

      {error ? (
        <div className="ec-live-error">
          <strong>Refresh issue:</strong> {error}
        </div>
      ) : null}

      <section className="ec-live-first-grid">
        <div className="ec-trading-pulse">
          <div className="ec-pulse-heading">
            <div>
              <span>Trading pulse</span>
              <div className="ec-revenue-value">
                <small>{primaryGross?.currency ?? 'Revenue'}</small>
                <strong>
                  {primaryGross
                    ? new Intl.NumberFormat('en-KE', { maximumFractionDigits: 0 }).format(
                        Number(primaryGross.amountMinor) / 100,
                      )
                    : '—'}
                </strong>
              </div>
              <div className="ec-pulse-inline-stats">
                <span>
                  <b>{velocityList(snapshot.sales.currentSalesVelocity)}</b> sales velocity
                </span>
                <span>
                  <b>{currentOrderRate(snapshot, now).toFixed(1)}/min</b> completed orders
                </span>
                <span>
                  <b>{averageList(snapshot.sales.averageOrderValue)}</b> average order
                </span>
              </div>
            </div>
            <div className="ec-pulse-window" aria-label="Chart time window">
              {(['15m', '30m', '60m', 'event'] as const).map((value) => (
                <button
                  type="button"
                  key={value}
                  data-active={pulseWindow === value}
                  onClick={() => setPulseWindow(value)}
                >
                  {value === 'event' ? 'Event' : value}
                </button>
              ))}
            </div>
          </div>
          <SalesPulseChart snapshot={snapshot} window={pulseWindow} now={now} />
        </div>

        <aside className="ec-action-rail">
          <div className="ec-action-rail-head">
            <div>
              <span>Act now</span>
              <h2>{liveActionAlerts.length} require attention</h2>
            </div>
            <span
              className="ec-live-count"
              data-tone={
                actionAlerts.some((alert) => alert.severity === 'CRITICAL') ? 'danger' : 'warning'
              }
            >
              {liveActionAlerts.length}
            </span>
          </div>

          {actionAlerts.length === 0 ? (
            <div className="ec-action-empty">
              <strong>No unresolved live issues.</strong>
              <span>Continue monitoring trading and venue health.</span>
            </div>
          ) : (
            <div className="ec-action-list">
              {actionAlerts.map((alert) => {
                const presentation = actionPresentation(alert, snapshot, deviceLabels);
                const risk = presentation.risk;
                const busy = risk ? busyAlertId === risk.alertId : false;
                return (
                  <article
                    className="ec-action-item"
                    data-tone={severityTone(alert.severity)}
                    key={alert.id}
                  >
                    <div className="ec-action-item-top">
                      <span>{severityLabel(alert.severity)}</span>
                      <small>Open {ageLabel(alert.openedAt, now)}</small>
                    </div>
                    <h3>{presentation.title}</h3>
                    <p>{presentation.context}</p>
                    <div className="ec-action-owner">
                      Owner: <strong>{alert.assignedActorId ? 'Assigned' : 'Unassigned'}</strong>
                    </div>
                    <div className="ec-action-buttons">
                      {risk && alert.actionable ? (
                        <>
                          {risk.state === 'OPEN' ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void actOnInventoryAlert(risk, 'ACKNOWLEDGE')}
                            >
                              Acknowledge
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="ec-live-primary"
                            disabled={busy}
                            onClick={() => void actOnInventoryAlert(risk, 'ASSIGN')}
                          >
                            Assign to me
                          </button>
                        </>
                      ) : null}
                      <Link href={presentation.actionHref}>{presentation.actionLabel} →</Link>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </aside>
      </section>

      <section className="ec-live-metric-strip" aria-label="Operational pulse">
        <div>
          <span>Payment success</span>
          <strong>{(payment.successRate * 100).toFixed(1)}%</strong>
          <small>
            {payment.succeededCount} / {payment.totalCount} payments
          </small>
        </div>
        <div>
          <span>Tills reporting</span>
          <strong>
            {reportingDevices} / {snapshot.devices.length}
          </strong>
          <small>{deviceIssues.length} need attention</small>
        </div>
        <div>
          <span>Stockout risk</span>
          <strong>{criticalRisks.length} critical</strong>
          <small>{warningRisks.length} additional warnings</small>
        </div>
        <div>
          <span>Needs verification</span>
          <strong>{moneyList(payment.unknownValue)}</strong>
          <small>{payment.unknownCount} payment transactions</small>
        </div>
        <div>
          <span>Queued sale updates</span>
          <strong>{queuedUploads}</strong>
          <small>
            across {snapshot.devices.filter((device) => device.edgeBacklogCount > 0).length} tills
          </small>
        </div>
        <div>
          <span>Last sale</span>
          <strong>{ageLabel(snapshot.sales.lastSaleAt, now)}</strong>
          <small>{lastSaleLocation}</small>
        </div>
      </section>

      <section className="ec-live-section">
        <div className="ec-live-section-heading">
          <div>
            <span>Venue health</span>
            <h2>Where is the event strongest — and where is it under pressure?</h2>
          </div>
          <small>Revenue, payment truth and till health by sales location</small>
        </div>
        <div className="ec-location-matrix">
          <div className="ec-location-matrix-head">
            <span>Location</span>
            <span>Revenue</span>
            <span>Velocity</span>
            <span>Payments</span>
            <span>Tills</span>
            <span>Issues</span>
          </div>
          {snapshot.salesLocations.map((location) => (
            <div className="ec-location-lane" key={location.salesLocationId}>
              <strong>{location.name}</strong>
              <span>{moneyList(location.grossSales, true)}</span>
              <span>{velocityList(location.currentSalesVelocity)}</span>
              <span>
                {location.paymentSuccessRate === null
                  ? '—'
                  : `${(location.paymentSuccessRate * 100).toFixed(1)}%`}
              </span>
              <span>
                {location.tillsHealthy}/{location.tillsTotal}
              </span>
              <span data-tone={location.issueCount > 0 ? 'warning' : 'success'}>
                {location.issueCount > 0 ? location.issueCount : 'Clear'}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="ec-live-detail-grid">
        <section className="ec-live-domain">
          <div className="ec-live-domain-head">
            <div>
              <span>Inventory</span>
              <h2>Stock at risk</h2>
            </div>
            <Link href="/inventory">Open inventory →</Link>
          </div>
          <div className="ec-risk-list">
            {snapshot.inventory.risks.slice(0, 5).map((risk) => {
              const cover = risk.minutesOfCover ? Math.max(0, Number(risk.minutesOfCover)) : null;
              const coverWidth = cover === null ? 0 : Math.min(100, (cover / 60) * 100);
              return (
                <div className="ec-risk-line" key={risk.alertId}>
                  <div>
                    <strong>{plainInventoryTitle(risk)}</strong>
                    <span>
                      {risk.inventoryLocationName ?? 'Event-wide'} ·{' '}
                      {coverLabel(risk.minutesOfCover)}
                    </span>
                  </div>
                  <div className="ec-cover-track" aria-label={coverLabel(risk.minutesOfCover)}>
                    <span
                      style={{ width: `${coverWidth}%` }}
                      data-tone={severityTone(risk.severity)}
                    />
                  </div>
                  <small>
                    {risk.suggestedTransferQuantityBase && risk.suggestedSourceLocationName
                      ? `Move ${quantityLabel(risk.suggestedTransferQuantityBase)} from ${risk.suggestedSourceLocationName}`
                      : 'No transfer recommendation'}
                  </small>
                </div>
              );
            })}
          </div>
        </section>

        <section className="ec-live-domain">
          <div className="ec-live-domain-head">
            <div>
              <span>Payments</span>
              <h2>{(payment.successRate * 100).toFixed(1)}% successful</h2>
            </div>
            <Link href="/event-close">Reconcile →</Link>
          </div>
          <div className="ec-payment-status-bar" aria-label="Payment attempt status distribution">
            <span data-state="success" style={{ flex: payment.succeededCount }} />
            <span data-state="pending" style={{ flex: payment.pendingCount }} />
            <span data-state="unknown" style={{ flex: payment.unknownCount }} />
            <span data-state="failed" style={{ flex: payment.failedCount }} />
          </div>
          <div className="ec-payment-status-legend">
            <span>
              <i data-state="success" /> {payment.succeededCount} successful
            </span>
            <span>
              <i data-state="pending" /> {payment.pendingCount} pending
            </span>
            <span>
              <i data-state="unknown" /> {payment.unknownCount} verify
            </span>
            <span>
              <i data-state="failed" /> {payment.failedCount} failed
            </span>
          </div>
          <div className="ec-payment-exposure">
            <span>Unresolved value</span>
            <strong>{moneyList(payment.unknownValue)}</strong>
          </div>
          {configurationAlerts.length > 0 ? (
            <div className="ec-config-note">
              <strong>
                {configurationAlerts.length} payment configuration item
                {configurationAlerts.length === 1 ? '' : 's'} need setup attention.
              </strong>
              <span>{configurationAlerts.map((alert) => alert.title).join(' · ')}</span>
            </div>
          ) : null}
        </section>
      </section>

      <section className="ec-live-detail-grid">
        <section className="ec-live-domain">
          <div className="ec-live-domain-head">
            <div>
              <span>Tills</span>
              <h2>{deviceIssues.length} need attention</h2>
            </div>
            <Link href="/sync-health">Open device health →</Link>
          </div>
          {deviceIssues.length === 0 ? (
            <div className="ec-live-empty">
              <strong>All tills reporting normally.</strong>
            </div>
          ) : (
            <div className="ec-device-exception-list">
              {deviceIssues.map((device) => (
                <div key={device.deviceId}>
                  <span
                    className="ec-device-status-mark"
                    data-tone={device.status === 'STALE' ? 'danger' : 'warning'}
                  />
                  <div>
                    <strong>{deviceLabels.get(device.deviceId) ?? device.deviceId}</strong>
                    <small>
                      {device.status === 'STALE' ? 'Not reporting' : 'Delayed'} · heartbeat{' '}
                      {ageLabel(device.lastSeenAt, now)}
                    </small>
                  </div>
                  <b>{device.edgeBacklogCount} queued</b>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="ec-live-domain">
          <div className="ec-live-domain-head">
            <div>
              <span>Products</span>
              <h2>Commercial mix meets stock pressure</h2>
            </div>
          </div>
          <div className="ec-product-ranking">
            {snapshot.topProducts.slice(0, 5).map((product) => {
              const maxGross = Math.max(
                ...snapshot.topProducts.map((candidate) =>
                  Number(amountTotal(candidate.grossSales)),
                ),
                1,
              );
              const gross = Number(amountTotal(product.grossSales));
              const risk = snapshot.inventory.risks.find(
                (candidate) => candidate.skuId === product.skuId,
              );
              return (
                <div key={product.skuId}>
                  <div className="ec-product-rank-copy">
                    <strong>{product.name}</strong>
                    <span>
                      {moneyList(product.grossSales, true)} · {product.quantitySold} units
                    </span>
                  </div>
                  <div className="ec-product-bar">
                    <span style={{ width: `${(gross / maxGross) * 100}%` }} />
                  </div>
                  <small data-tone={risk ? severityTone(risk.severity) : 'neutral'}>
                    {risk ? coverLabel(risk.minutesOfCover) : 'Stock stable'}
                  </small>
                </div>
              );
            })}
          </div>
        </section>
      </section>

      <section className="ec-live-section ec-transfer-section">
        <div className="ec-live-section-heading">
          <div>
            <span>Replenishment</span>
            <h2>Active transfers</h2>
          </div>
          <Link href="/inventory">Manage stock →</Link>
        </div>
        {snapshot.inventory.activeTransfers.length === 0 ? (
          <div className="ec-live-empty">
            <strong>No active stock transfers.</strong>
          </div>
        ) : (
          <div className="ec-transfer-journeys">
            {snapshot.inventory.activeTransfers.map((transfer) => (
              <div className="ec-transfer-journey" key={transfer.transferId}>
                <strong>{transfer.sourceLocationName ?? 'Source'}</strong>
                <div className="ec-transfer-path">
                  <span
                    data-done={['PICKING', 'DISPATCHED', 'IN_TRANSIT', 'RECEIVED'].includes(
                      transfer.state,
                    )}
                  >
                    Picking
                  </span>
                  <i />
                  <span
                    data-done={['DISPATCHED', 'IN_TRANSIT', 'RECEIVED'].includes(transfer.state)}
                  >
                    Dispatched
                  </span>
                  <i />
                  <span data-done={['IN_TRANSIT', 'RECEIVED'].includes(transfer.state)}>
                    In transit
                  </span>
                  <i />
                  <span data-done={transfer.state === 'RECEIVED'}>Received</span>
                </div>
                <strong>{transfer.destinationLocationName ?? 'Destination'}</strong>
                <small>
                  {transfer.assignedActorId ? 'Owner assigned' : 'Owner unassigned'} · updated{' '}
                  {ageLabel(transfer.updatedAt, now)}
                </small>
              </div>
            ))}
          </div>
        )}
      </section>

      <footer className="ec-live-footer">
        <span>
          Realtime:{' '}
          {mode === 'LIVE'
            ? 'connected'
            : mode === 'POLLING'
              ? 'recovering with polling'
              : mode.toLowerCase()}
        </span>
        <span>Cloud dashboards may lag; local-first checkout remains independent.</span>
      </footer>
    </main>
  );
}
