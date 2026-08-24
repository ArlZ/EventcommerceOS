import { WorkflowRail } from '../workflow-ui';
import { SyncHealthClient } from './sync-health-client';

const workflow = [
  {
    label: 'Detect',
    detail: 'Spot registers with sales waiting to upload or no recent online reporting.',
  },
  {
    label: 'Diagnose',
    detail: 'Confirm service can continue locally before checking connectivity.',
  },
  {
    label: 'Recover',
    detail: 'Restore online reporting without interrupting locally committed sales.',
  },
];

export default function SyncHealthPage() {
  return (
    <main className="ec-page">
      <header className="ec-page-header">
        <div>
          <p className="ec-page-kicker">During trading</p>
          <h1 className="ec-page-title">Find registers that need attention</h1>
          <p className="ec-page-description">
            See which registers are reporting normally and which need connectivity attention. A
            reporting delay alone is not a reason to stop locally committed selling.
          </p>
        </div>
        <span className="ec-status-pill">Operational health</span>
      </header>
      <WorkflowRail steps={workflow} />
      <SyncHealthClient />
    </main>
  );
}
