import { SyncHealthClient } from './sync-health-client';

export default function SyncHealthPage() {
  return (
    <main style={{ fontFamily: 'sans-serif', maxWidth: 960, margin: '48px auto', padding: 24 }}>
      <a href="/">Back to Event Control</a>
      <h1>Device Sync Health</h1>
      <p>This view is operational only and never blocks POS ordering.</p>
      <SyncHealthClient />
    </main>
  );
}
