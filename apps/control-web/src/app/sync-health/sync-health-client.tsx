'use client';

import type { DeviceCloudStatus } from '@event-commerce/contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { readEventControlContext, writeEventControlContext } from '../event-context';

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

function deviceNeedsAttention(device: DeviceCloudStatus): boolean {
  return device.edgeBacklogCount > 0 || !device.lastCloudDeliveryAt;
}

function deviceStatus(device: DeviceCloudStatus): {
  label: string;
  tone: 'success' | 'warning';
  detail: string;
} {
  if (device.edgeBacklogCount > 0) {
    return {
      label: 'Sales waiting to upload',
      tone: 'warning',
      detail: `${device.edgeBacklogCount} locally accepted update(s) are waiting to upload. Do not stop selling for this delay alone.`,
    };
  }
  if (!device.lastCloudDeliveryAt) {
    return {
      label: 'Upload not confirmed',
      tone: 'warning',
      detail:
        'No online delivery has been confirmed yet. Check connectivity; this alone does not prove the register is unavailable.',
    };
  }
  return {
    label: 'Reporting normally',
    tone: 'success',
    detail: 'No pending uploads are currently reported.',
  };
}

export function SyncHealthClient() {
  const [organisationId, setOrganisationId] = useState('');
  const [organisationName, setOrganisationName] = useState('');
  const [activeOrganisationId, setActiveOrganisationId] = useState('');
  const [devices, setDevices] = useState<DeviceCloudStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  useEffect(() => {
    const context = readEventControlContext();
    if (context.organisationId) {
      setOrganisationId(context.organisationId);
      setActiveOrganisationId(context.organisationId);
    }
    if (context.organisationName) setOrganisationName(context.organisationName);
  }, []);

  const refresh = useCallback(async () => {
    if (!activeOrganisationId) return;
    setLoading(true);
    try {
      const response = await fetch(`${apiBase}/sync/devices`, {
        cache: 'no-store',
        headers: { 'x-organisation-id': activeOrganisationId },
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

  function loadOrganisation() {
    const nextOrganisationId = organisationId.trim();
    if (!nextOrganisationId) {
      setError('Enter an organisation ID.');
      return;
    }
    const currentContext = readEventControlContext();
    const sameOrganisation = currentContext.organisationId === nextOrganisationId;
    if (!sameOrganisation) setOrganisationName('');
    writeEventControlContext({
      organisationId: nextOrganisationId,
      organisationName: sameOrganisation ? (currentContext.organisationName ?? null) : null,
      eventId: sameOrganisation ? (currentContext.eventId ?? null) : null,
      eventName: sameOrganisation ? (currentContext.eventName ?? null) : null,
    });
    if (nextOrganisationId === activeOrganisationId) {
      void refresh();
      return;
    }
    setDevices([]);
    setLastUpdatedAt(null);
    setError(null);
    setActiveOrganisationId(nextOrganisationId);
  }

  useEffect(() => {
    if (!activeOrganisationId) return undefined;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(timer);
  }, [activeOrganisationId, refresh]);

  const devicesWithBacklog = useMemo(
    () => devices.filter((device) => device.edgeBacklogCount > 0).length,
    [devices],
  );
  const devicesWithoutCloudDelivery = useMemo(
    () => devices.filter((device) => !device.lastCloudDeliveryAt).length,
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
      {activeOrganisationId ? (
        <details className="ec-context-switcher">
          <summary>Change organisation</summary>
          <div
            className="ec-context-loader ec-context-loader--embedded"
            style={{ gridTemplateColumns: '1fr auto' }}
          >
            <input
              value={organisationId}
              onChange={(event) => setOrganisationId(event.target.value)}
              placeholder="Organisation ID"
              aria-label="Organisation ID"
            />
            <button type="button" onClick={loadOrganisation} disabled={loading}>
              {loading ? 'Loading…' : 'Load organisation'}
            </button>
          </div>
        </details>
      ) : (
        <div className="ec-context-loader" style={{ gridTemplateColumns: '1fr auto' }}>
          <input
            value={organisationId}
            onChange={(event) => setOrganisationId(event.target.value)}
            placeholder="Organisation ID"
            aria-label="Organisation ID"
          />
          <button type="button" onClick={loadOrganisation} disabled={loading}>
            {loading ? 'Loading…' : 'Load sync health'}
          </button>
        </div>
      )}

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
        <SyncMetric label="Need attention" value={attentionDevices.toString()} />
        <SyncMetric label="Waiting to upload" value={devicesWithBacklog.toString()} />
        <SyncMetric label="Upload not confirmed" value={devicesWithoutCloudDelivery.toString()} />
      </section>

      {!activeOrganisationId && !error ? (
        <div className="ec-callout">
          <strong>Select an organisation to begin.</strong> This screen shows whether registers are
          reporting online and whether uploads are waiting. It does not decide whether a local till
          can continue taking orders.
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
