'use client';

import type {
  EventCloseReport,
  EventCloseStoredReportView,
  EventConfigurationView,
} from '@event-commerce/contracts';
import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { eventControlContextChangedEvent, readEventControlContext } from '../event-context';
import { OperatorContextSwitcher } from '../operator-context-switcher';

const apiBase = process.env.NEXT_PUBLIC_CLOUD_API_URL ?? 'http://localhost:3001';

type ActiveEvent = { organisationId: string; eventId: string };

function headers(organisationId: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-event-control-request': 'browser',
    'x-organisation-id': organisationId,
  };
}

async function requestJson<T>(
  path: string,
  organisationId: string,
  init: RequestInit = {},
): Promise<T> {
  const requestHeaders = new Headers(headers(organisationId));
  new Headers(init.headers).forEach((value, key) => requestHeaders.set(key, value));
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: requestHeaders,
    credentials: 'include',
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
}

function money(currency: string, amountMinor: string | null): string {
  if (amountMinor === null) return '—';
  const value = Number(amountMinor) / 100;
  if (!Number.isFinite(value)) return `${currency} ${amountMinor} minor`;
  try {
    return new Intl.NumberFormat('en-KE', { style: 'currency', currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function compactId(value: string): string {
  if (value.length <= 20) return value;
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function moneyRows(rows: Array<{ currency: string; amountMinor: string }>): string {
  return rows.length === 0
    ? '—'
    : rows.map((row) => money(row.currency, row.amountMinor)).join(' • ');
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="ec-kpi">
      <span className="ec-kpi-label">{label}</span>
      <strong className="ec-kpi-value">{value}</strong>
    </div>
  );
}

function AttentionCard({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="ec-attention-card" data-attention={count > 0}>
      <div className="ec-attention-card-title">
        <strong>{title}</strong>
        <span className="ec-attention-count">{count}</span>
      </div>
      {children}
    </section>
  );
}

export function EventCloseClient() {
  const [organisationId, setOrganisationId] = useState('');
  const [eventId, setEventId] = useState('');
  const [active, setActive] = useState<ActiveEvent | null>(null);
  const [report, setReport] = useState<EventCloseReport | null>(null);
  const [stored, setStored] = useState<EventCloseStoredReportView[]>([]);
  const [configuration, setConfiguration] = useState<EventConfigurationView | null>(null);
  const [reason, setReason] = useState('Operational close review completed');
  const [pendingAction, setPendingAction] = useState<'close' | 'reopen' | null>(null);
  const [contextHydrated, setContextHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const syncContext = () => {
      const context = readEventControlContext();
      setOrganisationId(context.organisationId ?? '');
      setEventId(context.eventId ?? '');
      setActive(null);
      setReport(null);
      setStored([]);
      setConfiguration(null);
      setError(null);
      setPendingAction(null);
      setContextHydrated(true);
    };

    syncContext();
    window.addEventListener(eventControlContextChangedEvent, syncContext);
    return () => window.removeEventListener(eventControlContextChangedEvent, syncContext);
  }, []);

  useEffect(() => {
    if (!contextHydrated || !organisationId.trim() || !eventId.trim()) return;
    void load();
  }, [contextHydrated, organisationId, eventId]);

  async function refresh(target: ActiveEvent): Promise<void> {
    const [nextReport, revisions, nextConfiguration] = await Promise.all([
      requestJson<EventCloseReport>(
        `/event-close/events/${encodeURIComponent(target.eventId)}/report`,
        target.organisationId,
      ),
      requestJson<EventCloseStoredReportView[]>(
        `/event-close/events/${encodeURIComponent(target.eventId)}/reports`,
        target.organisationId,
      ),
      requestJson<EventConfigurationView>(
        `/organisations/${encodeURIComponent(target.organisationId)}/configuration`,
        target.organisationId,
      ).catch(() => null),
    ]);
    setReport(nextReport);
    setStored(revisions);
    setConfiguration(nextConfiguration);
    setError(null);
  }

  async function load(): Promise<void> {
    const target = { organisationId: organisationId.trim(), eventId: eventId.trim() };
    if (!target.organisationId || !target.eventId) {
      setError('Select an organisation and event from Event Control.');
      return;
    }
    setBusy(true);
    setPendingAction(null);
    try {
      await refresh(target);
      setActive(target);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to load event close report');
    } finally {
      setBusy(false);
    }
  }

  async function action(kind: 'close' | 'reopen'): Promise<void> {
    if (!active || !reason.trim()) return;
    setBusy(true);
    try {
      await requestJson(
        `/event-close/events/${encodeURIComponent(active.eventId)}/${kind}`,
        active.organisationId,
        {
          method: 'POST',
          body: JSON.stringify({
            actionId: `${kind}:${crypto.randomUUID()}`,
            reason: reason.trim(),
          }),
        },
      );
      await refresh(active);
      setPendingAction(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : `Unable to ${kind} event`);
    } finally {
      setBusy(false);
    }
  }

  async function download(path: string, filename: string): Promise<void> {
    if (!active) return;
    setBusy(true);
    try {
      const response = await fetch(`${apiBase}${path}`, {
        headers: headers(active.organisationId),
        credentials: 'include',
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Unable to export reconciliation report',
      );
    } finally {
      setBusy(false);
    }
  }

  const reconciliationUnresolved =
    report?.financialReconciliation.some((row) => !row.conclusive) ?? false;
  const attentionRequired =
    (report?.unresolvedPayments.length ?? 0) > 0 ||
    (report?.openTransfers.length ?? 0) > 0 ||
    (report?.unresolvedCriticalAlerts.length ?? 0) > 0 ||
    reconciliationUnresolved ||
    (report?.close.sourceChangedSinceLastClose ?? false);
  const isOperationallyClosed = report?.close.state === 'OPERATIONALLY_CLOSED';

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

  function inventoryLocationLabel(id: string): string {
    return inventoryLocationNames.get(id) ?? `Location ${compactId(id)}`;
  }

  function skuLabel(id: string): string {
    return skuNames.get(id) ?? `SKU ${compactId(id)}`;
  }

  return (
    <main className="ec-page ec-page--wide">
      <header className="ec-page-header">
        <div>
          <p className="ec-page-kicker">After trading</p>
          <h1 className="ec-page-title">Close & reconcile the event</h1>
          <p className="ec-page-description">
            Review uncertainty before recording an operational close. Closing snapshots current
            truth; it never erases unresolved payments, stock movement or later source corrections.
          </p>
        </div>
        <span className="ec-status-pill" data-tone={attentionRequired ? 'warning' : 'success'}>
          {report
            ? isOperationallyClosed
              ? attentionRequired
                ? 'Closed — review changes'
                : 'Closed'
              : attentionRequired
                ? 'Resolve before close'
                : 'Ready to close'
            : 'Not loaded'}
        </span>
      </header>

      <section className="ec-panel" style={{ marginBottom: 18 }}>
        <div className="ec-panel-heading">
          <div>
            <p className="ec-eyebrow">Event context</p>
            <h2>Select the event being closed</h2>
            <p>
              Close controls only load organisations and events available to the signed-in operator.
            </p>
          </div>
        </div>
        <OperatorContextSwitcher />
      </section>

      <div className="ec-operations-stack" aria-busy={busy}>
        {report ? (
          <div className="ec-context-bar">
            <div>
              <strong>{report.event.name}</strong>
              {configuration?.organisation.name ? ` • ${configuration.organisation.name}` : ''}
            </div>
            <div className="ec-context-bar-actions">
              <button type="button" disabled={busy} onClick={() => void load()}>
                {busy ? 'Refreshing…' : 'Refresh close review'}
              </button>
            </div>
          </div>
        ) : null}

        {error ? <div className="ec-banner ec-banner--danger">{error}</div> : null}

        {!report ? (
          <div className="ec-callout">
            <strong>Select the event above before closing.</strong> The review starts with
            unresolved payment, inventory and operational signals, then moves into detailed
            reconciliation and immutable close evidence.
          </div>
        ) : null}

        {report ? (
          <>
            <Panel
              title="Close readiness"
              description={
                isOperationallyClosed
                  ? 'Review what changed after the stored close before deciding whether an audited reopen is needed.'
                  : 'Start with what still needs action, then decide whether to close now or resolve it first.'
              }
              priority
            >
              <div className="ec-close-summary">
                <Metric label="Event" value={report.event.name} />
                <Metric label="Operational state" value={report.close.state} />
                <Metric
                  label="Current reconciliation"
                  value={reconciliationUnresolved ? 'Needs review' : 'Conclusive'}
                />
                <Metric
                  label="Last close revision"
                  value={report.close.lastClosedRevision?.toString() ?? 'Not closed'}
                />
              </div>

              {attentionRequired ? (
                <div className="ec-banner ec-banner--warning" style={{ marginTop: 14 }}>
                  <strong>
                    {isOperationallyClosed
                      ? 'Review changes after close.'
                      : 'Resolve what you can before closing.'}
                  </strong>{' '}
                  {isOperationallyClosed
                    ? 'The stored close remains immutable. Reopen before recording a new close revision if source truth needs reconciliation.'
                    : 'You can still record a close, but unresolved items will remain visible in the stored evidence.'}
                  <div className="ec-form-actions" style={{ marginTop: 10 }}>
                    {report.unresolvedPayments.length > 0 || reconciliationUnresolved ? (
                      <Link className="ec-panel-link" href="/command-centre">
                        Review payments in Live →
                      </Link>
                    ) : null}
                    {report.openTransfers.length > 0 ||
                    report.unresolvedCriticalAlerts.length > 0 ? (
                      <Link className="ec-panel-link" href="/inventory">
                        Review inventory →
                      </Link>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="ec-banner ec-banner--success" style={{ marginTop: 14 }}>
                  <strong>{isOperationallyClosed ? 'Event is closed.' : 'Ready to close.'}</strong>{' '}
                  No unresolved payment, transfer, critical inventory or financial reconciliation
                  exceptions are currently projected.
                </div>
              )}

              {report.close.sourceChangedSinceLastClose ? (
                <div className="ec-banner ec-banner--danger" style={{ marginTop: 14 }}>
                  <strong>Source truth changed after the last close.</strong> The stored revision
                  has not been rewritten. Review live reconciliation and use an audited reopen
                  before recording a new close revision.
                </div>
              ) : null}

              {reconciliationUnresolved ? (
                <div className="ec-banner ec-banner--warning" style={{ marginTop: 14 }}>
                  <strong>Financial reconciliation is not conclusive.</strong> Any operational close
                  will preserve that uncertainty rather than guessing a final result.
                </div>
              ) : null}

              <div className="ec-close-attention-grid">
                <AttentionCard title="Unresolved payments" count={report.unresolvedPayments.length}>
                  {report.unresolvedPayments.length === 0 ? (
                    <p className="ec-empty">None projected.</p>
                  ) : null}
                  <div className="ec-list">
                    {report.unresolvedPayments.map((payment) => (
                      <div className="ec-list-row" key={payment.paymentAttemptId}>
                        <strong>
                          {payment.providerId} • {payment.status}
                        </strong>
                        <div>
                          Order {compactId(payment.orderId)} •{' '}
                          {money(payment.currency, payment.amountMinor)}
                        </div>
                        <small>
                          {payment.reconciliationErrorCode ??
                            payment.failureCode ??
                            'Awaiting provider truth'}
                        </small>
                      </div>
                    ))}
                  </div>
                </AttentionCard>

                <AttentionCard title="Transfers not received" count={report.openTransfers.length}>
                  {report.openTransfers.length === 0 ? (
                    <p className="ec-empty">None projected.</p>
                  ) : null}
                  <div className="ec-list">
                    {report.openTransfers.map((transfer) => (
                      <div className="ec-list-row" key={transfer.transferId}>
                        <strong>{transfer.state}</strong>
                        <div>
                          {inventoryLocationLabel(transfer.sourceLocationId)} →{' '}
                          {inventoryLocationLabel(transfer.destinationLocationId)}
                        </div>
                      </div>
                    ))}
                  </div>
                </AttentionCard>

                <AttentionCard
                  title="Critical inventory alerts"
                  count={report.unresolvedCriticalAlerts.length}
                >
                  {report.unresolvedCriticalAlerts.length === 0 ? (
                    <p className="ec-empty">None projected.</p>
                  ) : null}
                  <div className="ec-list">
                    {report.unresolvedCriticalAlerts.map((alert) => (
                      <div className="ec-list-row" key={alert.alertId}>
                        <strong>
                          {alert.alertType} • {alert.state}
                        </strong>
                        <div>
                          {skuLabel(alert.skuId)} • available {alert.availableQuantityBase}
                        </div>
                      </div>
                    ))}
                  </div>
                </AttentionCard>
              </div>
            </Panel>

            <Panel
              title={
                isOperationallyClosed
                  ? report.close.sourceChangedSinceLastClose
                    ? 'Reopen to reconcile changes'
                    : 'Event is operationally closed'
                  : attentionRequired
                    ? 'Close with unresolved items'
                    : 'Record operational close'
              }
              description={
                isOperationallyClosed
                  ? 'Reopening is an audited state change. Use it when post-close source changes need a new operational close revision.'
                  : attentionRequired
                    ? 'Closing now is allowed, but it will preserve the unresolved items above rather than clearing them.'
                    : 'No projected blockers remain. Every close or reopen still requires an audit reason.'
              }
            >
              {attentionRequired ? (
                <div className="ec-banner ec-banner--warning" style={{ marginBottom: 12 }}>
                  <strong>
                    {isOperationallyClosed
                      ? 'Attention items remain after close.'
                      : 'Closing will not resolve these items.'}
                  </strong>{' '}
                  {isOperationallyClosed
                    ? 'Reopen only when a new audited operating state is required; the stored close remains unchanged.'
                    : 'The close revision will preserve their current state so they remain visible for follow-up and audit.'}
                </div>
              ) : null}
              <div className="ec-close-actions">
                <input
                  aria-label="Audit reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
                {pendingAction ? (
                  <div className="ec-inline-confirm ec-inline-confirm--wide" role="alert">
                    <div>
                      <strong>
                        {pendingAction === 'close'
                          ? attentionRequired
                            ? 'Confirm close with unresolved items'
                            : 'Confirm operational close'
                          : 'Confirm audited reopen'}
                      </strong>
                      <small>
                        {pendingAction === 'close'
                          ? attentionRequired
                            ? 'This records the current state without marking unresolved payments, transfers, alerts or reconciliation items as resolved.'
                            : 'This records an immutable close revision using the current reconciliation state.'
                          : 'This reopens operations with the audit reason entered above.'}
                      </small>
                    </div>
                    <div className="ec-form-actions">
                      <button
                        className="ec-button-primary"
                        type="button"
                        disabled={busy || !reason.trim()}
                        onClick={() => void action(pendingAction)}
                      >
                        {pendingAction === 'close' ? 'Confirm close' : 'Confirm reopen'}
                      </button>
                      <button type="button" disabled={busy} onClick={() => setPendingAction(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : isOperationallyClosed ? (
                  <button type="button" disabled={busy} onClick={() => setPendingAction('reopen')}>
                    Reopen with audit reason
                  </button>
                ) : (
                  <button
                    className="ec-button-primary"
                    type="button"
                    disabled={busy}
                    onClick={() => setPendingAction('close')}
                  >
                    {attentionRequired
                      ? 'Record close with unresolved items'
                      : 'Record operational close'}
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy || !active}
                  onClick={() =>
                    void download(
                      `/event-close/events/${encodeURIComponent(active!.eventId)}/report.csv`,
                      `event-close-${active!.eventId}-live.csv`,
                    )
                  }
                >
                  Export live CSV
                </button>
              </div>
            </Panel>

            <section className="ec-control-grid">
              <Panel title="Sales reconciliation" description="Commercial totals from event truth.">
                <div className="ec-metric-list">
                  <div className="ec-metric-pair">
                    <small>Gross</small>
                    <strong>{moneyRows(report.sales.grossSales)}</strong>
                  </div>
                  <div className="ec-metric-pair">
                    <small>Discounts</small>
                    <strong>{moneyRows(report.sales.discounts)}</strong>
                  </div>
                  <div className="ec-metric-pair">
                    <small>Comps</small>
                    <strong>{moneyRows(report.sales.comps)}</strong>
                  </div>
                  <div className="ec-metric-pair">
                    <small>Voids</small>
                    <strong>{moneyRows(report.sales.voids)}</strong>
                  </div>
                  <div className="ec-metric-pair">
                    <small>Refunds</small>
                    <strong>{moneyRows(report.sales.refunds)}</strong>
                  </div>
                  <div className="ec-metric-pair">
                    <small>Net sales</small>
                    <strong>{moneyRows(report.sales.netSales)}</strong>
                  </div>
                </div>
              </Panel>

              <Panel
                title="Sales vs tender"
                description="A non-conclusive currency remains explicitly unresolved."
              >
                <div className="ec-list">
                  {report.financialReconciliation.map((row) => (
                    <div className="ec-list-row" key={row.currency}>
                      <strong>
                        {row.currency} • {row.conclusive ? 'CONCLUSIVE' : 'UNRESOLVED'}
                      </strong>
                      <div>Net sales: {money(row.currency, row.netSalesMinor)}</div>
                      <div>Electronic: {money(row.currency, row.electronicNetTenderMinor)}</div>
                      <div>Cash expected: {money(row.currency, row.cashExpectedMinor)}</div>
                      <div>Accounted tender: {money(row.currency, row.accountedTenderMinor)}</div>
                      <div>Variance: {money(row.currency, row.salesToTenderVarianceMinor)}</div>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel
                title="Provider reconciliation"
                description="Provider truth remains separate from local transaction intent."
              >
                {report.providerReconciliation.length === 0 ? (
                  <p className="ec-empty">No provider payments.</p>
                ) : null}
                <div className="ec-list">
                  {report.providerReconciliation.map((provider) => (
                    <div
                      className="ec-list-row"
                      key={`${provider.providerId}:${provider.currency}`}
                    >
                      <strong>
                        {provider.providerId} • {provider.transactionReconciliationStatus}
                      </strong>
                      <div>
                        {provider.succeededCount} success •{' '}
                        {money(provider.currency, provider.succeededValueMinor)}
                      </div>
                      <div>
                        {provider.pendingCount} pending • {provider.unknownCount} unknown •{' '}
                        {provider.failedCount} failed
                      </div>
                      <small>{provider.settlementStatus}</small>
                    </div>
                  ))}
                </div>
              </Panel>
            </section>

            <section className="ec-control-grid">
              <Panel
                title="Cash expected vs declared"
                description="Review every cash scope and its variance before sign-off."
              >
                {report.cash.scopes.length === 0 ? (
                  <p className="ec-empty">No cash scopes.</p>
                ) : null}
                <div className="ec-list">
                  {report.cash.scopes.map((scope) => (
                    <div
                      className="ec-list-row"
                      key={`${scope.salesLocationId}|${scope.deviceId}|${scope.cashierId}|${scope.currency}`}
                    >
                      <strong>{scope.salesLocationName ?? compactId(scope.salesLocationId)}</strong>
                      <div>
                        Register {compactId(scope.deviceId)} • cashier {compactId(scope.cashierId)}
                      </div>
                      <div>
                        Expected {money(scope.currency, scope.expectedMinor)} • Declared{' '}
                        {money(scope.currency, scope.declaredMinor)}
                      </div>
                      <small>
                        {scope.declarationStatus} • variance{' '}
                        {money(scope.currency, scope.varianceMinor)}
                      </small>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel
                title="Inventory count variance"
                description="Physical count remains distinct from expected ledger quantity."
              >
                {report.inventoryVariances.length === 0 ? (
                  <p className="ec-empty">No closed count variance detail.</p>
                ) : null}
                <div className="ec-list">
                  {report.inventoryVariances.map((variance) => (
                    <div
                      className="ec-list-row"
                      key={`${variance.inventoryLocationId}|${variance.skuId}`}
                    >
                      <strong>{variance.skuName}</strong> •{' '}
                      {variance.inventoryLocationName ??
                        inventoryLocationLabel(variance.inventoryLocationId)}
                      <div>
                        Expected {variance.expectedQuantityBase} • Physical{' '}
                        {variance.physicalQuantityBase} • Variance {variance.varianceQuantityBase}
                      </div>
                      <small>
                        {variance.valuationStatus === 'VALUED'
                          ? `Value ${money(variance.valuationCurrency ?? '', variance.varianceValueMinor)}`
                          : 'Unit cost missing — variance value is intentionally not guessed.'}
                      </small>
                    </div>
                  ))}
                </div>
              </Panel>
            </section>

            <Panel
              title="Payment method totals"
              description="Method-level tender and unresolved attempt detail."
            >
              <div className="ec-table-wrap">
                <table className="ec-table">
                  <thead>
                    <tr>
                      <th align="left">Method</th>
                      <th align="left">Currency</th>
                      <th align="right">Success</th>
                      <th align="right">Gross</th>
                      <th align="right">Refund</th>
                      <th align="right">Reversal</th>
                      <th align="right">Net tender</th>
                      <th align="right">Unresolved</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.paymentMethods.map((method) => (
                      <tr key={`${method.methodId}:${method.currency}`}>
                        <td>{method.methodId}</td>
                        <td>{method.currency}</td>
                        <td align="right">{method.succeededCount}</td>
                        <td align="right">{money(method.currency, method.grossTenderMinor)}</td>
                        <td align="right">{money(method.currency, method.refundMinor)}</td>
                        <td align="right">{money(method.currency, method.reversalMinor)}</td>
                        <td align="right">{money(method.currency, method.netTenderMinor)}</td>
                        <td align="right">{method.unresolvedAttemptCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel
              title="Drilldown by bar, device and cashier"
              description="Use operational dimensions to investigate variance without rewriting source records."
            >
              <div className="ec-table-wrap">
                <table className="ec-table">
                  <thead>
                    <tr>
                      <th align="left">Dimension</th>
                      <th align="left">ID</th>
                      <th align="left">Currency</th>
                      <th align="right">Txns</th>
                      <th align="right">Gross</th>
                      <th align="right">Discount</th>
                      <th align="right">Comp</th>
                      <th align="right">Void</th>
                      <th align="right">Refund</th>
                      <th align="right">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.drilldowns.map((row) => (
                      <tr key={`${row.dimensionType}|${row.dimensionId}|${row.currency}`}>
                        <td>{row.dimensionType}</td>
                        <td>{row.dimensionName ?? compactId(row.dimensionId)}</td>
                        <td>{row.currency}</td>
                        <td align="right">{row.transactionCount}</td>
                        <td align="right">{money(row.currency, row.grossSalesMinor)}</td>
                        <td align="right">{money(row.currency, row.discountMinor)}</td>
                        <td align="right">{money(row.currency, row.compMinor)}</td>
                        <td align="right">{money(row.currency, row.voidMinor)}</td>
                        <td align="right">{money(row.currency, row.refundMinor)}</td>
                        <td align="right">{money(row.currency, row.netSalesMinor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel
              title="Immutable close revisions"
              description="Every stored close is digest-bound and remains available for audit."
            >
              {stored.length === 0 ? (
                <p className="ec-empty">No operational close revision stored yet.</p>
              ) : null}
              {stored.map((item) => (
                <div className="ec-revision-row" key={item.reportId}>
                  <div className="ec-revision-meta">
                    <strong>
                      Revision {item.revision} • {new Date(item.createdAt).toLocaleString()}
                    </strong>
                    <span>
                      SHA-256: <code>{item.sha256}</code>
                    </span>
                    <span>
                      Source version: <code>{item.sourceVersionToken}</code>
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={busy || !active}
                    onClick={() =>
                      void download(
                        `/event-close/events/${encodeURIComponent(active!.eventId)}/reports/${item.revision}/export.csv`,
                        `event-close-${active!.eventId}-r${item.revision}.csv`,
                      )
                    }
                  >
                    Export revision {item.revision}
                  </button>
                </div>
              ))}
            </Panel>
          </>
        ) : null}
      </div>
    </main>
  );
}
