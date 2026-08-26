import { OperatorContextSwitcher } from '../operator-context-switcher';
import { WorkflowRail } from '../workflow-ui';
import { EventScheduleClient } from './event-schedule-client';

const workflow = [
  {
    label: 'Select event',
    detail:
      'Choose an assigned organisation and event from the authenticated Event Control context.',
  },
  { label: 'Review window', detail: 'Confirm timezone, start and end against the operating plan.' },
  { label: 'Lock before Edge', detail: 'Save the DRAFT schedule before bootstrap and rehearsal.' },
];

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
      <WorkflowRail steps={workflow} />
      <section className="ec-panel" style={{ marginTop: 18 }}>
        <div className="ec-panel-heading">
          <div>
            <p className="ec-eyebrow">Event context</p>
            <h2>Select the event being prepared</h2>
            <p>
              Only organisations and events available to your signed-in operator account are shown.
            </p>
          </div>
        </div>
        <OperatorContextSwitcher />
      </section>
      <div className="ec-callout">
        <strong>Use this before Edge bootstrap:</strong> the Event Edge rehearsal must use the same
        event end time recorded in Cloud.
      </div>
      <EventScheduleClient />
    </main>
  );
}
