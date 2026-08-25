# Cloud replay/convergence evidence

This gate complements `docs/DURABILITY_EVIDENCE_VERIFIER.md`.

The existing durability report proves POS local durability, restart preservation and POS-to-Edge convergence. It deliberately leaves `gateBSatisfied=false` because a separate observation of the authoritative Cloud projections is required to prove that replaying already-delivered event data does not create duplicate sales or inventory effects.

This procedure produces that independent Cloud proof. It does **not** approve live money by itself.

## What it proves

A PASS report requires all of the following for the same exact release and event:

- the POS/Edge durability report is already PASS and contains at least 100 new closed orders;
- the Cloud gains exactly the same number of new closed-order projections after the first drain;
- Cloud processed-event IDs, order projections, inventory Edge event IDs, inventory ledger entries and stock projection are internally well-formed;
- Cloud reconciliation exception counts are zero;
- after a deliberate duplicate replay, the complete measured Cloud business view is byte-for-byte equivalent after canonicalisation;
- the duplicate replay creates no new processed event, order state, inventory Edge event, inventory ledger effect or stock movement.

The final combined report sets `gateBSatisfied=true` only when every check passes.

## Safety boundary

The snapshot command is read-only and opens a PostgreSQL `REPEATABLE READ READ ONLY` transaction. It never writes to the Cloud database and never includes `DATABASE_URL`, database credentials, signing material, payment credentials or customer/payment payloads in the evidence file.

The unresolved reconciliation counts are intentionally **global**, not just event-scoped. A supposedly clean controlled exercise should not hide unrelated unresolved Cloud reconciliation faults.

## Prerequisites

Use the same exact release under the durability drill. Set:

- `RELEASE_COMMIT` to the exact lowercase 40-character release SHA;
- `DATABASE_URL` in the shell/environment used by the Cloud administration machine.

Do not put either secret-bearing connection strings or credentials in the manifest.

## 1. Capture the Cloud baseline

Immediately before reconnecting/draining the controlled WAN-offline drill:

```powershell
$env:RELEASE_COMMIT = "<exact-release-sha>"

pnpm --filter @event-commerce/cloud-api cloud-convergence:snapshot -- `
  "<event-id>" `
  "artifacts\pilot\cloud-baseline.json"
```

`DATABASE_URL` must already be configured securely in the environment.

## 2. Drain normally and capture first convergence

Reconnect the Event Edge and allow the normal outbound queues to drain. Wait until the POS/Edge final diagnostics show the expected zero backlog.

Then capture:

```powershell
pnpm --filter @event-commerce/cloud-api cloud-convergence:snapshot -- `
  "<event-id>" `
  "artifacts\pilot\cloud-first-drain.json"
```

Do not reset, delete or edit any Cloud/Edge/POS state between checkpoints.

## 3. Deliberately replay the already-delivered batch

Use the controlled Edge replay mechanism/runbook to submit the **same already-delivered event identities and inventory event identities again**. Do not manufacture new event IDs, sequences, ledger IDs or idempotency keys for this step; that would test a new business event rather than duplicate delivery.

The Cloud APIs should classify duplicates without applying a second business effect.

After replay has completed, capture:

```powershell
pnpm --filter @event-commerce/cloud-api cloud-convergence:snapshot -- `
  "<event-id>" `
  "artifacts\pilot\cloud-after-duplicate-replay.json"
```

## 4. Create the convergence manifest

Example:

```json
{
  "schemaVersion": 1,
  "releaseCommit": "0123456789abcdef0123456789abcdef01234567",
  "eventId": "event-id",
  "minimumNewClosedOrders": 100,
  "durabilityReport": "durability-evidence.json",
  "baseline": "cloud-baseline.json",
  "firstDrain": "cloud-first-drain.json",
  "afterDuplicateReplay": "cloud-after-duplicate-replay.json"
}
```

All referenced paths are resolved relative to the manifest.

## 5. Verify Gate B

```powershell
pnpm pilot:cloud-convergence:verify -- `
  "artifacts\pilot\cloud-convergence-manifest.json" `
  "artifacts\pilot\cloud-convergence-evidence.json"
```

A PASS report contains:

- `status: "PASS"`;
- `gateBSatisfied: true`;
- matching first-drain and post-replay business SHA-256 digests;
- `liveMoneyApproved: false`.

Hash the retained report into the normal pilot evidence pack.

## Failure rules

Stop and investigate if any of these occurs:

- exact release or event identity differs between any input;
- Cloud new closed-order count does not exactly equal the POS durability delta;
- either reconciliation count is non-zero;
- duplicate replay adds a processed event, order projection, inventory event, ledger entry or stock movement;
- an inventory ledger ID or idempotency key is duplicated in the snapshot;
- checkpoint timestamps are out of order.

Never delete duplicate rows, clear reconciliation exceptions, wipe the POS, reset Edge queues or alter evidence files merely to turn the gate green. Preserve the failed state and diagnose the cause.
