import { ConfigurationClient } from './configuration-client';

const setupSequence =
  'organisation → event → sales locations → inventory locations → catalogue → menu.';
const setupFollowUp = 'Device assignment and final pre-open checks follow in pilot operations.';

export default function ConfigurationPage() {
  return (
    <main className="ec-page">
      <header className="ec-page-header">
        <div>
          <p className="ec-page-kicker">Before trading</p>
          <h1 className="ec-page-title">Prepare the event</h1>
          <p className="ec-page-description">
            Create the event and operating structure in sequence: locations, catalogue and menu.
            Complete this before registers are handed to the trading team.
          </p>
        </div>
        <span className="ec-status-pill" data-tone="warning">
          Setup mode
        </span>
      </header>
      <div className="ec-callout">
        <strong>Pilot workflow:</strong> {setupSequence} {setupFollowUp}
      </div>
      <ConfigurationClient />
    </main>
  );
}
