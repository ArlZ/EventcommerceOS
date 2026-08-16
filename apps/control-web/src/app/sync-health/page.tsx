import { SyncHealthClient } from './sync-health-client';

export default function SyncHealthPage() {
  return (
    <main className="ec-page">
      <header className="ec-page-header">
        <div>
          <p className="ec-page-kicker">During trading</p>
          <h1 className="ec-page-title">Find registers that need attention</h1>
          <p className="ec-page-description">
            Use device and sync state to identify delayed or disconnected registers. POS ordering is
            local-first and must remain available while recovery happens in the background.
          </p>
        </div>
        <span className="ec-status-pill">Operational health</span>
      </header>
      <SyncHealthClient />
    </main>
  );
}
