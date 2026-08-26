import { ReadinessClient } from './readiness-client';

export default function ReadinessPage() {
  return (
    <main className="ec-page">
      <header className="ec-page-header">
        <div>
          <p className="ec-page-kicker">Controlled pilot</p>
          <h1 className="ec-page-title">Know what is ready before the event starts.</h1>
          <p className="ec-page-description">
            Turn event configuration into an explicit preflight. Fix incomplete setup before moving
            into venue, payment, offline and reconciliation testing.
          </p>
        </div>
        <span className="ec-status-pill" data-tone="warning">
          Preflight
        </span>
      </header>

      <ReadinessClient />
    </main>
  );
}
