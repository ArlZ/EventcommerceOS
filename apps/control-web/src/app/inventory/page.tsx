import { WorkflowRail } from '../workflow-ui';
import { InventoryOperationsClient } from './inventory-operations-client';

const workflow = [
  { label: 'Spot risk', detail: 'Start with critical and low-cover stock positions.' },
  {
    label: 'Move safely',
    detail: 'Use replenishment guidance without bypassing transfer controls.',
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
            Keep the highest stockout risks visible while the team coordinates replenishment.
          </p>
        </div>
        <span className="ec-status-pill">Cloud view</span>
      </header>
      <WorkflowRail steps={workflow} />
      <div className="ec-callout">
        <strong>Connectivity rule:</strong> This view can lag Event Edge during a network partition.
        <br />
        Never stop local selling because this dashboard is delayed.
      </div>
      <InventoryOperationsClient />
    </main>
  );
}
