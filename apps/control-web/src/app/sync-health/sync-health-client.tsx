'use client';

import type { DeviceCloudStatus } from '@event-commerce/contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { eventControlContextChangedEvent, readEventControlContext } from '../event-context';
import { OperatorContextSwitcher } from '../operator-context-switcher';

const apiBase = process.env.NEXT_PUBLIC_CLOUD_API_URL ?? 'http://localhost:3001';

function ageLabel(value: string): string {
  const ageSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
  if (ageSeconds < 60) return `${ageSeconds}s ago`;
  if (ageSeconds < 3600) return `${Math.floor(ageSeconds / 60)}m ago`;
  return `${Math.floor(ageSeconds / 3600)}h ago`;
}

function updatedLabel(value: number | null): string {
  if (value === null) return 'Not loaded yet';
  const seconds = Math.max(0, Math.floor((Date.now() - value) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

function compactId(value: string): string {
  if (value.length <= 22) return value;
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
}

function operationalStatus(
  device: DeviceCloudStatus,
): 'HEALTHY' | 'DEGRADED' | 'STALE' {
  if (device.operationalStatus) return device.operationalStatus;
  const ageSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(device.lastSeenAt)) / 1000));
  if (ageSeconds > 120) return 'STALE';
  if (device.edgeBacklogCount > 0 || ageSeconds > 30) return 'DEGRADED';
  return 'HEALTHY';
}

function deviceNeedsAttention(device: DeviceCloudStatus): boolean {
  return operationalStatus(device) !== 'HEALTHY';
}

function deviceStatus(device: DeviceCloudStatus): {
  label: string;
  tone: 'success' | 'warning' | 'danger';
  detail: string;
} {
  const status = operationalStatus(device);
  if (status === 'STALE') {
    return {
      label: 'Not reporting',
      tone: 'danger',
      detail: `Last heartbeat ${ageLabel(device.lastSeenAt)}. Local selling status cannot be confirmed from Cloud telemetry.`,
    };
  }
  if (device.edgeBacklogCount > 0) {
    return {
      label: 'Reporting with queued uploads',
      tone: 'warning',
      detail: `${device.edgeBacklogCount} locally accepted update(s) are waiting to upload. Local selling can continue while Cloud catches up.`,
    };
  }
  if (status === 'DEGRADED') {
    return {
      label: 'Reporting late',
      tone: 'warning',
      detail: `Last heartbeat ${ageLabel(device.lastSeenAt)}. Check the venue network if this delay continues.`,
    };
  }
  return {
    label: 'Reporting normally',
    tone: 'success',
    detail: 'Heartbeat is current and no pending uploads are reported.',
  };
}

export function SyncHealthClient() {
  const [organisationName, setOrganisationName] = useState('');
  const [activeOrganisationId, setActiveOrganisationId] = useState('');
  const [contextEventId, setContextEventId] = useState('');
  const [devices, setDevices] = useState<DeviceCloudStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  useEffect(() => {
    const syncContext = () => {
      const context = readEventControlContext();
      setActiveOrganisationId(context.organisationId ?? '');
      setOrganisationName(context.organisationName ?? '');
      setContextEventId(context.eventId ?? '');
      setDevices([]);
      setLastUpdatedAt(null);
      setError(null);
    };

    syncContext();
    window.addEventListener(eventControlContextChangedEvent, syncContext);
    return () => window.removeEventListener(eventControlContextChangedEvent, syncContext);
  }, []);

  const refresh = useCallback(async () => {
    if (!activeOrganisationId) return;
    setLoading(true);
    try {
      const response = await fetch(`${apiBase}/sync/devices`, {
        cache: 'no-store',
        credentials: 'include',
        headers: {
          'x-event-control-request': 'browser',
          'x-organisation-id': activeOrganisationId,
        },
      });
      if (!response.ok) throw new Error(`Cloud API returned ${response.status}`);
      setDevices((await response.json()) as DeviceCloudStatus[]);
      setLastUpdatedAt(Date.now());
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to load sync health');
    } finally {
      setLoading(false);
    }
  }, [activeOrganisationId]);

  useEffect(() => {
    if (!activeOrganisationId) return undefined;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(timer);
  }, [activeOrganisationId, contextEventId, refresh]);

  const queuedUploadCount = useMemo(
    () => devices.reduce((sum, device) => sum + device.edgeBacklogCount, 0),
    [devices],
  );
  const healthyDevices = useMemo(
    () => devices.filter((device) => operationalStatus(device) === 'HEALTHY').length,
    [devices],
  );
  const attentionDevices = useMemo(() => devices.filter(deviceNeedsAttention).length, [devices]);
  const orderedDevices = useMemo(
    () =>
      [...devices].sort((left, right) => {
        const attentionDelta =
          Number(deviceNeedsAttention(right)) - Number(deviceNeedsAttention(left));
        if (attentionDelta !== 0) return attentionDelta;
        return Date.parse(left.lastSeenAt) - Date.parse(right.lastSeenAt);
      }),
    [devices],
  );

  return (
    <section
      className="ec-operations-stack"
      style={{ marginTop: 18 }}
      aria-busy={loading}
      aria-live="polite"
    >
      <section className="ec-panel">
        <div className="ec-panel-heading">
          <div>
            <p className="ec-eyebrow">Operator context</p>
            <h2>Select the organisation being monitored</h2>
            <p>Only organisations available to the signed-in operator are shown.</p>
          </div>
        </div>
        <OperatorContextSwitcher />
      </section>

      {error ? (
        <div className="ec-banner ec-banner--danger">Device health unavailable: {error}</div>
      ) : null}

      <div className="ec-context-bar">
        <div>
          <strong>{organisationName || 'Register reporting'}</strong>
          {activeOrganisationId ? (
            <>
              <span className="ec-context-subtle"> • refreshes every 5 seconds</span>
              <span className="ec-context-subtle"> • updated {updatedLabel(lastUpdatedAt)}</span>
            </>
          ) : (
            <span className="ec-context-subtle"> • select an organisation</span>
          )}
        </div>
        {activeOrganisationId ? (
          <div className="ec-context-bar-actions">
            <button type="button" onClick={() => void refresh()} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh now'}
            </button>
            <span
              className="ec-status-pill"
              data-tone={attentionDevices > 0 ? 'warning' : 'success'}
            >
              {attentionDevices > 0
                ? `${attentionDevices} register${attentionDevices === 1 ? '' : 's'} need attention`
                : devices.length > 0
                  ? 'All reporting'
                  : 'Awaiting telemetry'}
            </span>
          </div>
        ) : null}
      </div>

      <section className="ec-kpi-grid" aria-label="Device sync summary">
        <SyncMetric label="Registers seen" value={devices.length.toString()} />
        <SyncMetric label="Healthy" value={healthyDevices.toString()} />
        <SyncMetric label="Need attention" value={attentionDevices.toString()} />
        <SyncMetric label="Queued sale updates" value={queuedUploadCount.toString()} />
      </section>

      {!activeOrganisationId && !error ? (
        <div className="ec-callout">
          <strong>Select an organisation above to begin.</strong> This screen shows whether
          registers are reporting online and whether uploads are waiting. It does not decide whether
          a local till can continue taking orders.
        </div>
      ) : null}

      {activeOrganisationId && devices.length === 0 && !error && !loading ? (
        <div className="ec-empty-state">
          <strong>No register updates have reached the online service yet.</strong> This does not
          prove a till is unavailable; check the venue's local server and network before
          interrupting service.
        </div>
      ) : null}

      <section className="ec-control-grid">
        {orderedDevices.map((device) => {
          const status = deviceStatus(device);
          const edgeAcceptanceGap = Math.max(
            0,
            device.lastSequenceSeen - device.edgeAcceptedThroughSequence,
          );
          return (
            <article className="ec-panel" key={device.deviceId}>
              <div className="ec-panel-heading">
                <div className="ec-entity-heading">
                  <p className="ec-eyebrow">Register</p>
                  <h2>{compactId(device.deviceId)}</h2>
                  <p>Last register activity {ageLabel(device.lastSeenAt)}</p>
                </div>
                <span className="ec-status-pill" data-tone={status.tone}>
                  {status.label}
                </span>
              </div>

              <div
                className={status.tone === 'warning' ? 'ec-banner ec-banner--warning' : 'ec-banner'}
              >
                {status.detail}
              </div>

              <div className="ec-metric-list" style={{ marginTop: 14 }}>
                <div className="ec-metric-pair">
                  <small>Pending uploads</small>
                  <strong>{device.edgeBacklogCount}</strong>
                </div>
                <div className="ec-metric-pair">
                  <small>Last online update</small>
                  <strong>
                    {device.lastCloudDeliveryAt
                      ? ageLabel(device.lastCloudDeliveryAt)
                      : 'Not yet confirmed'}
                  </strong>
                </div>
              </div>

              <details className="ec-context-switcher" style={{ marginTop: 14 }}>
                <summary>Technical sync details</summary>
                <div className="ec-metric-list" style={{ marginTop: 12 }}>
                  <div className="ec-metric-pair">
                    <small>Register sequence seen</small>
                    <strong>{device.lastSequenceSeen}</strong>
                  </div>
                  <div className="ec-metric-pair">
                    <small>Event Edge accepted through</small>
                    <strong>{device.edgeAcceptedThroughSequence}</strong>
                  </div>
                  <div className="ec-metric-pair">
                    <small>POS → Edge acceptance gap</small>
                    <strong>{edgeAcceptanceGap}</strong>
                  </div>
                  <div className="ec-metric-pair">
                    <small>Edge → Cloud backlog</small>
                    <strong>{device.edgeBacklogCount}</strong>
                  </div>
                </div>
              </details>
            </article>
          );
        })}
      </section>
    </section>
  );
}

function SyncMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="ec-kpi">
      <span className="ec-kpi-label">{label}</span>
      <strong className="ec-kpi-value">{value}</strong>
    </div>
  );
}
