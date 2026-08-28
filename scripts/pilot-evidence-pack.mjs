import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createInitialManifest } from './pilot-evidence.mjs';

const SHA_PATTERN = /^[0-9a-f]{40}$/;

export const PILOT_FIELD_STAGES = [
  {
    id: 'hardwareNetwork',
    title: 'Venue hardware and network',
    docs: 'docs/HARDWARE_NETWORK_FIELD_EVIDENCE.md',
    command:
      'pnpm pilot:hardware-network:verify -- inputs/hardware-network.json evidence/hardware-network-field-evidence.json',
    reviewEvidence: 'evidence/hardware-network-field-evidence.json',
  },
  {
    id: 'paymentFaultMatrix',
    title: 'M-PESA Daraja sandbox fault matrix',
    docs: 'docs/MPESA_SANDBOX_FAULT_MATRIX.md',
    command:
      'pnpm pilot:mpesa:verify -- inputs/mpesa-sandbox.json evidence/mpesa-sandbox-fault-matrix.json',
    reviewEvidence: 'evidence/mpesa-sandbox-fault-matrix.json',
  },
  {
    id: 'offlineDurability',
    title: 'Offline durability and Cloud convergence',
    docs: 'docs/CLOUD_CONVERGENCE_EVIDENCE.md',
    command:
      'pnpm pilot:cloud-convergence:verify -- inputs/cloud-convergence.json evidence/cloud-convergence-evidence.json',
    reviewEvidence: 'evidence/cloud-convergence-evidence.json',
    prerequisite:
      'First collect POS/Event Edge durability checkpoints and run pnpm pilot:durability:verify.',
  },
  {
    id: 'abuseFloodExercise',
    title: 'Authorised abuse and flood exercise',
    docs: 'docs/PILOT_RUNBOOK.md',
    command:
      'pnpm pilot:abuse:verify -- inputs/abuse-field.json evidence/abuse-field-evidence.json',
    reviewEvidence: 'evidence/abuse-field-evidence.json',
  },
  {
    id: 'representativeRecovery',
    title: 'Representative backup and recovery',
    docs: 'docs/REPRESENTATIVE_RECOVERY_FIELD_EVIDENCE.md',
    command:
      'pnpm pilot:recovery:verify -- inputs/recovery-review.json evidence/representative-recovery-field-evidence.json',
    reviewEvidence: 'evidence/representative-recovery-field-evidence.json',
    prerequisite:
      'First run the exact-release backup/restore drill documented in docs/BACKUP_RESTORE.md.',
  },
  {
    id: 'inventoryCloseReconciliation',
    title: 'Inventory close reconciliation',
    docs: 'docs/EVENT_CLOSE_FIELD_EVIDENCE.md',
    command:
      'pnpm pilot:event-close:verify -- evidence/event-close.json evidence/event-close-verification.json',
    reviewEvidence: 'evidence/event-close-verification.json',
    sharedReportWith: 'controlledPilotClose',
  },
  {
    id: 'controlledPilotClose',
    title: 'Controlled pilot close',
    docs: 'docs/EVENT_CLOSE_FIELD_EVIDENCE.md',
    command:
      'pnpm pilot:event-close:verify -- evidence/event-close.json evidence/event-close-verification.json',
    reviewEvidence: 'evidence/event-close-verification.json',
    sharedReportWith: 'inventoryCloseReconciliation',
  },
];

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function ensureEmptyDirectory(root) {
  if (existsSync(root) && readdirSync(root).length > 0) {
    throw new Error(`refusing to initialize non-empty pilot evidence directory: ${root}`);
  }
  mkdirSync(root, { recursive: true, mode: 0o700 });
}

export function createPilotEvidencePack({
  releaseCommit,
  outputDir,
  eventName = '',
  eventDate = '',
  venue = '',
  deploymentMode = '',
  now = new Date(),
}) {
  if (!SHA_PATTERN.test(releaseCommit ?? '')) {
    throw new Error('releaseCommit must be a lowercase 40-character Git SHA');
  }
  if (!nonEmpty(outputDir)) throw new Error('outputDir is required');

  const root = resolve(outputDir);
  ensureEmptyDirectory(root);
  mkdirSync(resolve(root, 'inputs'), { recursive: true, mode: 0o700 });
  mkdirSync(resolve(root, 'evidence'), { recursive: true, mode: 0o700 });

  const createdAt = now.toISOString();
  const manifest = createInitialManifest(releaseCommit, createdAt);
  manifest.pilot = { eventName, eventDate, venue, deploymentMode };

  const plan = {
    schemaVersion: 1,
    createdAt,
    releaseCommit,
    liveMoneyApproved: false,
    disposition: 'NOT_RUN',
    instructions:
      'Run only against the exact release. Field stages remain NOT_RUN until real evidence is collected and a named reviewer explicitly signs it off.',
    governanceStages: [
      {
        id: 'branchProtection',
        status: 'NOT_RUN',
        instruction: 'Review protected-main evidence and attach it manually after named review.',
      },
      {
        id: 'dependencySecurity',
        status: 'NOT_RUN',
        instruction: 'Review exact-release SCA evidence and record blockingFindings after named review.',
      },
    ],
    fieldStages: PILOT_FIELD_STAGES.map((stage) => ({ ...stage, status: 'NOT_RUN' })),
    finalCommands: [
      'pnpm pilot:evidence:validate -- evidence.json',
      'pnpm pilot:release:review',
    ],
  };

  writeFileSync(resolve(root, 'evidence.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  });
  writeFileSync(resolve(root, 'execution-plan.json'), `${JSON.stringify(plan, null, 2)}\n`, {
    mode: 0o600,
  });

  return { root, manifest, plan };
}

function usage() {
  console.error(
    'Usage: node scripts/pilot-evidence-pack.mjs <release-sha> <output-dir> [event-name] [event-date] [venue] [deployment-mode]',
  );
}

function main() {
  const [releaseCommit, outputDir, eventName = '', eventDate = '', venue = '', deploymentMode = ''] =
    process.argv.slice(2);
  if (!releaseCommit || !outputDir) {
    usage();
    process.exitCode = 2;
    return;
  }
  const result = createPilotEvidencePack({
    releaseCommit,
    outputDir,
    eventName,
    eventDate,
    venue,
    deploymentMode,
  });
  console.log(`Controlled-pilot evidence pack initialized: ${result.root}`);
  console.log(`release=${releaseCommit} disposition=NOT_RUN liveMoneyApproved=false`);
  console.log('No pilot gate was marked PASS. Complete the real exercises and named reviews.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
