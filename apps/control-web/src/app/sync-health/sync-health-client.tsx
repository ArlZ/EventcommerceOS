'use client';

import type { DeviceCloudStatus } from '@event-commerce/contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';

const apiBase = process.env.NEXT_PUBLIC_CLOUD_API_URL ?? 'http://localhost:3001';

function ageLabel(value: string): string {
  const ageSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
  if (ageSeconds < 60) return `${ageSeconds}s ago`;
  if (ageSeconds < 3600) return `${Math.floor(ageSeconds / 60)}m ago`;
  return `${Math.floor(ageSeconds / 3600)}h ago`;
}

function deviceStatus(device: DeviceCloudStatus): {
  label: string;
  tone: 'success' | 'warning';
  detail: string;
} {
  if (device.edgeBacklogCount > 0) {
    return {
      label: 'Backlog waiting',
      tone: 'warning',
      detail: `${device.edgeBacklogCount} Edge update(s) still need Cloud delivery.`,
    };
  }
  if (!device.lastCloudDeliveryAt) {
    return {
      label: 'Cloud delivery not observed',
      tone: 'warning',
      detail: 'This register has reached Edge, but no Cloud delivery is currently reported.',
    };
  }
  return {
    label: 'Reporting',
    tone: 'success',
    detail: 'No Edge-to-Cloud backlog is currently reported.',
  };
}

export function SyncHealthClient() {
  const [organisationId, setOrganisationId] = useState('');
  const [activeOrganisationId, setActiveOrganisationId] = useState('');
  const [devices, setDevices] = useState<DeviceCloudStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
    if (nextOrganisationId === activeOrganisationId) {
      void refresh();
      return;
    }
    setDevices([]);
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

  return (
    <section className="ec-operations-stack" style={{ marginTop: 18 }}>
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

      {error ? (
        <div className="ec-banner ec-banner--danger">Device health unavailable: {error}</div>
      ) : null}

      <div className="ec-context-bar">
        <div>
          <strong>Cloud device telemetry</strong>
          {activeOrganisationId
            ? ` • organisation ${activeOrganisationId}`
            : ' • select an organisation'}
          {activeOrganisationId ? ' • refreshes every 5 seconds' : ''}
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading || !activeOrganisationId}
        >
          {loading ? 'Refreshing…' : 'Refresh now'}
        </button>
      </div>

      <section className="ec-kpi-grid" aria-label="Device sync summary">
        <SyncMetric label="Registers observed" value={devices.length.toString()} />
        <SyncMetric label="With Edge backlog" value={devicesWithBacklog.toString()} />
        <SyncMetric
          label="No Cloud delivery observed"
          value={devicesWithoutCloudDelivery.toString()}
        />
      </section>

      {!activeOrganisationId && !error ? (
        <div className="ec-callout">
          <strong>Select an organisation to begin.</strong> Sync Health is operator-authenticated and
          only returns register telemetry for the selected organisation.
        </div>
      ) : null}

      {activeOrganisationId && devices.length === 0 && !error ? (
        <div className="ec-callout">
          <strong>No register telemetry has reached Cloud yet.</strong> This does not prove a local
          POS is unavailable; confirm Event Edge and venue connectivity before intervening at the
          bar.
        </div>
      ) : null}

      <section className="ec-control-grid">
        {devices.map((device) => {
          const status = deviceStatus(device);
          return (
            <article className="ec-panel" key={device.deviceId}>
              <div className="ec-panel-heading">
                <div>
                  <h2>{device.deviceId}</h2>
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
                  <small>Register sequence seen</small>
                  <strong>{device.lastSequenceSeen}</strong>
                </div>
                <div className="ec-metric-pair">
                  <small>Event Edge accepted through</small>
                  <strong>{device.edgeAcceptedThroughSequence}</strong>
                </div>
                <div className="ec-metric-pair">
                  <small>Edge → Cloud backlog</small>
                  <strong>{device.edgeBacklogCount}</strong>
                </div>
                <div className="ec-metric-pair">
                  <small>Last Cloud delivery</small>
                  <strong>
                    {device.lastCloudDeliveryAt
                      ? ageLabel(device.lastCloudDeliveryAt)
                      : 'Not yet reported'}
                  </strong>
                </div>
              </div>
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
