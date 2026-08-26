import { OperatorContextSwitcher } from '../operator-context-switcher';
import { WorkflowRail } from '../workflow-ui';
import { InventoryOperationsClient } from './inventory-operations-client';

const workflow = [
  { label: 'Spot risk', detail: 'Start with critical and low-cover stock positions.' },
  {
    label: 'Move safely',
    detail: 'Follow the recommended physical move, then record it through venue transfer controls.',
  },
  {
    label: 'Verify receipt',
    detail: 'Keep stock in motion visible until destination receipt is recorded.',
  },
];

export default function InventoryPage() {
  return (
    <main className="ec-page">
      <header className="ec-page-header">
        <div>
          <p className="ec-page-kicker">During trading</p>
          <h1 className="ec-page-title">Protect stock availability</h1>
          <p className="ec-page-description">
            See what is at risk, what to move, and what is still in transit while the venue keeps
            selling locally.
          </p>
        </div>
        <span className="ec-status-pill">Read-only guidance</span>
      </header>
      <WorkflowRail steps={workflow} />
      <section className="ec-panel" style={{ marginTop: 18 }}>
        <div className="ec-panel-heading">
          <div>
            <p className="ec-eyebrow">Event context</p>
            <h2>Select the event being monitored</h2>
            <p>
              Inventory is scoped to organisations and events available to your signed-in operator
              account.
            </p>
          </div>
        </div>
        <OperatorContextSwitcher />
      </section>
      <div className="ec-callout">
        <strong>Connectivity rule:</strong> This view can lag Event Edge during a network partition.
        <br />
        Never stop local selling because this dashboard is delayed.
      </div>
      <InventoryOperationsClient />
    </main>
  );
}
