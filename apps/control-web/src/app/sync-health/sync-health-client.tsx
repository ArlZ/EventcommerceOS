'use client';

import { useEffect, useState } from 'react';

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

export function SyncHealthClient() {
  const [devices, setDevices] = useState<DeviceHealth[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const response = await fetch(`${apiBase}/sync/devices`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Cloud API returned ${response.status}`);
      setDevices((await response.json()) as DeviceHealth[]);
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to load sync health');
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div>
      {error ? <p style={{ color: 'crimson' }}>Sync health unavailable: {error}</p> : null}
      <button type="button" onClick={() => void refresh()} style={{ marginBottom: 16 }}>
        Refresh
      </button>
      {devices.length === 0 && !error ? <p>No device sync activity has reached Cloud yet.</p> : null}
      <div style={{ display: 'grid', gap: 12 }}>
        {devices.map((device) => (
          <article key={device.deviceId} style={{ border: '1px solid #ddd', borderRadius: 12, padding: 16 }}>
            <strong>{device.deviceId}</strong>
            <p style={{ marginBottom: 4 }}>Last seen: {ageLabel(device.lastSeenAt)}</p>
            <p style={{ margin: '4px 0' }}>
              Sequence seen {device.lastSequenceSeen} • Edge acknowledged through {device.edgeAcceptedThroughSequence}
            </p>
            <p style={{ margin: '4px 0' }}>Edge → Cloud backlog: {device.edgeBacklogCount}</p>
            <p style={{ marginTop: 4 }}>
              Last Cloud delivery: {device.lastCloudDeliveryAt ? ageLabel(device.lastCloudDeliveryAt) : 'not yet reported'}
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}
