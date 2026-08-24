import { WorkflowRail } from '../workflow-ui';
import { ConfigurationClient } from './configuration-client';

const setupSequence =
  'organisation → event → sales locations → inventory locations → catalogue → menu.';
const setupFollowUp = 'Device assignment and final pre-open checks follow in pilot operations.';

const workflow = [
  { label: 'Organisation', detail: 'Choose the operator that owns the event configuration.' },
  { label: 'Event', detail: 'Create the event and establish the trading context.' },
  { label: 'Locations', detail: 'Map guest-facing sales points and controlled stock locations.' },
  { label: 'Catalogue', detail: 'Create products and the sellable units the register will show.' },
  { label: 'Menu', detail: 'Assign the event menu to the correct sales locations.' },
  { label: 'Price', detail: 'Complete menu items and prices before pre-open checks.' },
];

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
      <WorkflowRail steps={workflow} />
      <div className="ec-callout">
        <strong>Pilot workflow:</strong> {setupSequence} {setupFollowUp}
      </div>
      <ConfigurationClient />
    </main>
  );
}
