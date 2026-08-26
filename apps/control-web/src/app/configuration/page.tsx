import { OperatorContextSwitcher } from '../operator-context-switcher';
import { WorkflowRail } from '../workflow-ui';
import { ConfigurationClient } from './configuration-client';
import { PosMenuPublicationControl } from './pos-menu-publication-control';

const setupSequence =
  'organisation → event → sales locations → inventory locations → catalogue → menu.';
const setupFollowUp =
  'Publish the approved DRAFT menu snapshots before device assignment and final pre-open checks.';

const workflow = [
  { label: 'Organisation', detail: 'Choose the operator that owns the event configuration.' },
  { label: 'Event', detail: 'Create the event and establish the trading context.' },
  { label: 'Locations', detail: 'Map guest-facing sales points and controlled stock locations.' },
  { label: 'Catalogue', detail: 'Create products and the sellable units the register will show.' },
  { label: 'Menu', detail: 'Assign the event menu to the correct sales locations.' },
  { label: 'Price', detail: 'Complete menu items and prices before pre-open checks.' },
  {
    label: 'Publish',
    detail: 'Freeze versioned POS menu snapshots for Event Edge while the event is still DRAFT.',
  },
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
            Publish the approved menu snapshot before registers are handed to the trading team.
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
      <section className="ec-panel" style={{ marginTop: 18 }}>
        <div className="ec-panel-heading">
          <div>
            <p className="ec-eyebrow">Event context</p>
            <h2>Select the organisation and event</h2>
            <p>
              Existing setup is available only for organisations assigned to your signed-in
              operator account.
            </p>
          </div>
        </div>
        <OperatorContextSwitcher />
      </section>
      <ConfigurationClient />
      <PosMenuPublicationControl />
    </main>
  );
}
