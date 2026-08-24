import { WorkflowRail } from '../workflow-ui';
import { SyncHealthClient } from './sync-health-client';

const workflow = [
  {
    label: 'Detect',
    detail: 'Surface backlog and missing Cloud delivery before it becomes operational noise.',
  },
  { label: 'Diagnose', detail: 'Separate local POS availability from Edge-to-Cloud delay.' },
  {
    label: 'Recover',
    detail: 'Restore connectivity without interrupting locally committed sales.',
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
            Use device and sync state to identify delayed or disconnected registers. POS ordering is
            local-first and must remain available while recovery happens in the background.
          </p>
        </div>
        <span className="ec-status-pill">Operational health</span>
      </header>
      <WorkflowRail steps={workflow} />
      <SyncHealthClient />
    </main>
  );
}
