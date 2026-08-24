import { EventScheduleClient } from './event-schedule-client';

export default function EventSchedulePage() {
  return (
    <main className="ec-page">
      <header className="ec-page-header">
        <div>
          <p className="ec-page-kicker">Before trading</p>
          <h1 className="ec-page-title">Event schedule</h1>
          <p className="ec-page-description">
            Review and update the trading window for a DRAFT event through the Cloud API. Live and
            closed events remain read-only here.
          </p>
        </div>
        <span className="ec-status-pill" data-tone="warning">
          Draft control
        </span>
      </header>
      <div className="ec-callout">
        <strong>Use this before Edge bootstrap:</strong> the Event Edge rehearsal must use the same
        event end time recorded in Cloud.
      </div>
      <EventScheduleClient />
    </main>
  );
}
