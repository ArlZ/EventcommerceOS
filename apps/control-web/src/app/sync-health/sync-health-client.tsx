'use client';

import { useEffect, useMemo, useState } from 'react';

type DeviceHealth = {
  deviceId: string;
  lastSeenAt: string;
  lastSequenceSeen: number;
  edgeAcceptedThroughSequence: number;
  edgeBacklogCount: number;
  lastCloudDeliveryAt: string | null;
};

const apiBase = process.env.NEXT_PUBLIC_CLOUD_API_URL ?? 'http://localhost:3001';

function ageLabel(value: string): string {
  const ageSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
  if (ageSeconds < 60) return `${ageSeconds}s ago`;
  if (ageSeconds < 3600) return `${Math.floor(ageSeconds / 60)}m ago`;
  return `${Math.floor(ageSeconds / 3600)}h ago`;
}

function deviceStatus(device: DeviceHealth): {
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
  const [devices, setDevices] = useState<DeviceHealth[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const response = await fetch(`${apiBase}/sync/devices`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Cloud API returned ${response.status}`);
      setDevices((await response.json()) as DeviceHealth[]);
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to load sync health');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(timer);
  }, []);

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
      {error ? (
        <div className="ec-banner ec-banner--danger">Device health unavailable: {error}</div>
      ) : null}

      <div className="ec-context-bar">
        <div>
          <strong>Cloud device telemetry</strong> • refreshes every 5 seconds
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading}>
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

      {devices.length === 0 && !error ? (
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
