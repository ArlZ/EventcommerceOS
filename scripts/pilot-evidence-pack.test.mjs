import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { PILOT_FIELD_STAGES, createPilotEvidencePack } from './pilot-evidence-pack.mjs';

const RELEASE = '6'.repeat(40);

function tempRoot() {
  return mkdtempSync(join(tmpdir(), 'event-commerce-pilot-pack-'));
}

test('pilot evidence pack initializes all gates as NOT_RUN and never approves live money', () => {
  const parent = tempRoot();
  const root = join(parent, 'pilot');
  try {
    const result = createPilotEvidencePack({
      releaseCommit: RELEASE,
      outputDir: root,
      eventName: 'Controlled event',
      eventDate: '2026-08-27',
      venue: 'Controlled venue',
      deploymentMode: 'single_instance_pilot',
      now: new Date('2026-08-27T12:00:00+03:00'),
    });

    assert.equal(result.manifest.releaseCommit, RELEASE);
    assert.equal(result.manifest.pilot.eventName, 'Controlled event');
    assert.ok(Object.values(result.manifest.gates).every((gate) => gate.status === 'NOT_RUN'));
    assert.equal(result.plan.liveMoneyApproved, false);
    assert.equal(result.plan.disposition, 'NOT_RUN');
    assert.ok(result.plan.fieldStages.every((stage) => stage.status === 'NOT_RUN'));
    assert.equal(result.plan.fieldStages.length, PILOT_FIELD_STAGES.length);

    const persistedManifest = JSON.parse(readFileSync(join(root, 'evidence.json'), 'utf8'));
    const persistedPlan = JSON.parse(readFileSync(join(root, 'execution-plan.json'), 'utf8'));
    assert.equal(persistedManifest.releaseCommit, RELEASE);
    assert.equal(persistedPlan.liveMoneyApproved, false);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('pilot evidence pack refuses to overwrite a non-empty evidence directory', () => {
  const root = tempRoot();
  try {
    writeFileSync(join(root, 'existing-evidence.txt'), 'do not overwrite\n');
    assert.throws(
      () => createPilotEvidencePack({ releaseCommit: RELEASE, outputDir: root }),
      /refusing to initialize non-empty pilot evidence directory/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('pilot evidence pack requires an exact full release SHA', () => {
  const parent = tempRoot();
  try {
    assert.throws(
      () => createPilotEvidencePack({ releaseCommit: 'abc123', outputDir: join(parent, 'pilot') }),
      /40-character Git SHA/,
    );
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('execution plan covers every field gate supported by reviewed evidence workflow', () => {
  assert.deepEqual(
    PILOT_FIELD_STAGES.map((stage) => stage.id),
    [
      'hardwareNetwork',
      'paymentFaultMatrix',
      'offlineDurability',
      'abuseFloodExercise',
      'representativeRecovery',
      'inventoryCloseReconciliation',
      'controlledPilotClose',
    ],
  );
  assert.ok(PILOT_FIELD_STAGES.every((stage) => stage.command.startsWith('pnpm pilot:')));
  assert.ok(PILOT_FIELD_STAGES.every((stage) => stage.reviewEvidence.startsWith('evidence/')));
});
