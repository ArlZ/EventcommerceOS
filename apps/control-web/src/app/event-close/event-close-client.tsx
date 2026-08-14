'use client';

import type {
  EventCloseReport,
  EventCloseStoredReportView,
} from '@event-commerce/contracts';
import { useMemo, useState } from 'react';

const apiBase = process.env.NEXT_PUBLIC_CLOUD_API_URL ?? 'http://localhost:3001';

type ActiveEvent = { organisationId: string; eventId: string };

function headers(actorId: string, organisationId: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-actor-id': actorId,
    'x-role': 'ADMIN',
    'x-organisation-id': organisationId,
  };
}

async function requestJson<T>(
  path: string,
  actorId: string,
  organisationId: string,
  init: RequestInit = {},
): Promise<T> {
  const requestHeaders = new Headers(headers(actorId, organisationId));
  new Headers(init.headers).forEach((value, key) => requestHeaders.set(key, value));
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: requestHeaders,
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

function moneyRows(rows: Array<{ currency: string; amountMinor: string }>): string {
  return rows.length === 0
    ? '—'
    : rows.map((row) => money(row.currency, row.amountMinor)).join(' • ');
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        border: '1px solid #ddd',
        borderRadius: 14,
        background: '#fff',
        padding: 16,
        minWidth: 0,
      }}
    >
      <h2 style={{ margin: '0 0 12px', fontSize: 18 }}>{title}</h2>
      {children}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <small>{label}</small>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function ExceptionBox({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        border: count > 0 ? '1px solid #ad3333' : '1px solid #ddd',
        borderRadius: 12,
        background: count > 0 ? '#fff7f7' : '#fff',
        padding: 14,
      }}
    >
      <strong>{title} • {count}</strong>
      <div style={{ marginTop: 8 }}>{children}</div>
    </section>
  );
}

export function EventCloseClient() {
  const actorId = useMemo(() => crypto.randomUUID(), []);
  const [organisationId, setOrganisationId] = useState('');
  const [eventId, setEventId] = useState('');
  const [active, setActive] = useState<ActiveEvent | null>(null);
  const [report, setReport] = useState<EventCloseReport | null>(null);
  const [stored, setStored] = useState<EventCloseStoredReportView[]>([]);
  const [reason, setReason] = useState('Operational close review completed');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh(target: ActiveEvent): Promise<void> {
    const [nextReport, revisions] = await Promise.all([
      requestJson<EventCloseReport>(
        `/event-close/events/${encodeURIComponent(target.eventId)}/report`,
        actorId,
        target.organisationId,
      ),
      requestJson<EventCloseStoredReportView[]>(
        `/event-close/events/${encodeURIComponent(target.eventId)}/reports`,
        actorId,
        target.organisationId,
      ),
    ]);
    setReport(nextReport);
    setStored(revisions);
    setError(null);
  }

  async function load(): Promise<void> {
    const target = { organisationId: organisationId.trim(), eventId: eventId.trim() };
    if (!target.organisationId || !target.eventId) {
      setError('Enter organisation ID and event ID.');
      return;
    }
    setBusy(true);
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
        actorId,
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
        headers: headers(actorId, active.organisationId),
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
      setError(failure instanceof Error ? failure.message : 'Unable to export reconciliation report');
    } finally {
      setBusy(false);
    }
  }

  const reconciliationUnresolved =
    report?.financialReconciliation.some((row) => !row.conclusive) ?? false;

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
        <h1 style={{ marginBottom: 6 }}>Event Close & Reconciliation</h1>
        <p style={{ marginTop: 0 }}>
          Operational close snapshots truth. It does not erase uncertainty or rewrite source ledgers.
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 8,
          }}
        >
          <input
            aria-label="Organisation ID"
            placeholder="Organisation ID"
            value={organisationId}
            onChange={(event) => setOrganisationId(event.target.value)}
            style={{ padding: 10 }}
          />
          <input
            aria-label="Event ID"
            placeholder="Event ID"
            value={eventId}
            onChange={(event) => setEventId(event.target.value)}
            style={{ padding: 10 }}
          />
          <button type="button" disabled={busy} onClick={() => void load()}>
            Load close report
          </button>
        </div>
        {error ? <p style={{ color: '#a32626' }}>{error}</p> : null}
      </header>

      {report ? (
        <div style={{ display: 'grid', gap: 16 }}>
          <Panel title="Close state">
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 12,
              }}
            >
              <Metric label="Event" value={report.event.name} />
              <Metric label="Operational state" value={report.close.state} />
              <Metric
                label="Last close revision"
                value={report.close.lastClosedRevision?.toString() ?? 'Not closed'}
              />
              <Metric
                label="Current reconciliation"
                value={reconciliationUnresolved ? 'UNRESOLVED' : 'CONCLUSIVE'}
              />
            </div>
            {report.close.sourceChangedSinceLastClose ? (
              <p style={{ color: '#a32626', fontWeight: 700 }}>
                Source truth changed after the last close. The stored close revision is unchanged; review the live reconciliation and re-close only after an audited reopen.
              </p>
            ) : null}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              <input
                aria-label="Close reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                style={{ padding: 9, minWidth: 320, flex: 1 }}
              />
              {report.close.state === 'OPERATIONALLY_CLOSED' ? (
                <button type="button" disabled={busy} onClick={() => void action('reopen')}>
                  Reopen with audit reason
                </button>
              ) : (
                <button type="button" disabled={busy} onClick={() => void action('close')}>
                  Operationally close
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

          <section
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 12,
            }}
          >
            <ExceptionBox title="Unresolved payments" count={report.unresolvedPayments.length}>
              {report.unresolvedPayments.length === 0 ? <span>None.</span> : null}
              {report.unresolvedPayments.map((payment) => (
                <div key={payment.paymentAttemptId} style={{ marginBottom: 8 }}>
                  <strong>{payment.providerId} • {payment.status}</strong>
                  <div>{payment.orderId} • {money(payment.currency, payment.amountMinor)}</div>
                  <small>{payment.reconciliationErrorCode ?? payment.failureCode ?? 'Awaiting provider truth'}</small>
                </div>
              ))}
            </ExceptionBox>
            <ExceptionBox title="Open / unreceived transfers" count={report.openTransfers.length}>
              {report.openTransfers.length === 0 ? <span>None.</span> : null}
              {report.openTransfers.map((transfer) => (
                <div key={transfer.transferId} style={{ marginBottom: 8 }}>
                  <strong>{transfer.state}</strong> • {transfer.sourceLocationId} → {transfer.destinationLocationId}
                </div>
              ))}
            </ExceptionBox>
            <ExceptionBox
              title="Unresolved critical alerts"
              count={report.unresolvedCriticalAlerts.length}
            >
              {report.unresolvedCriticalAlerts.length === 0 ? <span>None.</span> : null}
              {report.unresolvedCriticalAlerts.map((alert) => (
                <div key={alert.alertId} style={{ marginBottom: 8 }}>
                  <strong>{alert.alertType}</strong> • {alert.state}
                  <div>{alert.skuId} • available {alert.availableQuantityBase}</div>
                </div>
              ))}
            </ExceptionBox>
          </section>

          <section
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 12,
            }}
          >
            <Panel title="Sales reconciliation">
              <Metric label="Gross" value={moneyRows(report.sales.grossSales)} />
              <Metric label="Discounts" value={moneyRows(report.sales.discounts)} />
              <Metric label="Comps" value={moneyRows(report.sales.comps)} />
              <Metric label="Voids" value={moneyRows(report.sales.voids)} />
              <Metric label="Refunds" value={moneyRows(report.sales.refunds)} />
              <Metric label="Net sales" value={moneyRows(report.sales.netSales)} />
            </Panel>

            <Panel title="Sales vs tender">
              {report.financialReconciliation.map((row) => (
                <div key={row.currency} style={{ marginBottom: 12 }}>
                  <strong>{row.currency} • {row.conclusive ? 'CONCLUSIVE' : 'UNRESOLVED'}</strong>
                  <div>Net sales: {money(row.currency, row.netSalesMinor)}</div>
                  <div>Electronic: {money(row.currency, row.electronicNetTenderMinor)}</div>
                  <div>Cash expected: {money(row.currency, row.cashExpectedMinor)}</div>
                  <div>Accounted tender: {money(row.currency, row.accountedTenderMinor)}</div>
                  <div>Variance: {money(row.currency, row.salesToTenderVarianceMinor)}</div>
                </div>
              ))}
            </Panel>

            <Panel title="Provider reconciliation">
              {report.providerReconciliation.length === 0 ? <p>No provider payments.</p> : null}
              {report.providerReconciliation.map((provider) => (
                <div key={`${provider.providerId}:${provider.currency}`} style={{ marginBottom: 12 }}>
                  <strong>{provider.providerId} • {provider.transactionReconciliationStatus}</strong>
                  <div>{provider.succeededCount} success • {money(provider.currency, provider.succeededValueMinor)}</div>
                  <div>{provider.pendingCount} pending • {provider.unknownCount} unknown • {provider.failedCount} failed</div>
                  <small>{provider.settlementStatus}</small>
                </div>
              ))}
            </Panel>
          </section>

          <section
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: 16,
            }}
          >
            <Panel title="Cash expected vs declared">
              {report.cash.scopes.length === 0 ? <p>No cash scopes.</p> : null}
              {report.cash.scopes.map((scope) => (
                <div
                  key={`${scope.salesLocationId}|${scope.deviceId}|${scope.cashierId}|${scope.currency}`}
                  style={{ borderBottom: '1px solid #eee', padding: '8px 0' }}
                >
                  <strong>{scope.salesLocationName ?? scope.salesLocationId}</strong>
                  <div>{scope.deviceId} • {scope.cashierId}</div>
                  <div>Expected {money(scope.currency, scope.expectedMinor)} • Declared {money(scope.currency, scope.declaredMinor)}</div>
                  <small>{scope.declarationStatus} • variance {money(scope.currency, scope.varianceMinor)}</small>
                </div>
              ))}
            </Panel>

            <Panel title="Inventory count variance">
              {report.inventoryVariances.length === 0 ? <p>No closed count variance detail.</p> : null}
              {report.inventoryVariances.map((variance) => (
                <div key={`${variance.inventoryLocationId}|${variance.skuId}`} style={{ borderBottom: '1px solid #eee', padding: '8px 0' }}>
                  <strong>{variance.skuName}</strong> • {variance.inventoryLocationName ?? variance.inventoryLocationId}
                  <div>Expected {variance.expectedQuantityBase} • Physical {variance.physicalQuantityBase} • Variance {variance.varianceQuantityBase}</div>
                  <small>
                    {variance.valuationStatus === 'VALUED'
                      ? `Value ${money(variance.valuationCurrency ?? '', variance.varianceValueMinor)}`
                      : 'Unit cost missing — variance value is intentionally not guessed.'}
                  </small>
                </div>
              ))}
            </Panel>
          </section>

          <Panel title="Payment method totals">
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
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

          <Panel title="Drilldown by bar, device and cashier">
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
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
                      <td>{row.dimensionName ?? row.dimensionId}</td>
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

          <Panel title="Immutable close revisions">
            {stored.length === 0 ? <p>No operational close revision stored yet.</p> : null}
            {stored.map((item) => (
              <div
                key={item.reportId}
                style={{ borderBottom: '1px solid #eee', padding: '9px 0' }}
              >
                <strong>Revision {item.revision}</strong> • {new Date(item.createdAt).toLocaleString()}
                <div>SHA-256: <code>{item.sha256}</code></div>
                <div>Source version: <code>{item.sourceVersionToken}</code></div>
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
        </div>
      ) : (
        <p>Load an event to begin close review.</p>
      )}
    </main>
  );
}
