# Event Close field evidence

This field evidence gate verifies that a deployed controlled-pilot event can be closed from authoritative Cloud state without hiding unresolved payment, cash, inventory or reconciliation exceptions.

It complements the Event Close integration tests. A green automated test suite proves code behaviour; it does not prove that the real pilot event was reconciled and closed cleanly on the exact deployed release.

## What the collector retains

The collector reads only the deployed Cloud API and writes a local JSON evidence bundle containing:

- exact Cloud API release identity from `/health`;
- the live Event Close report;
- append-only close/reopen actions;
- every immutable stored close revision;
- SHA-256 and byte length of the latest stored CSV export.

The operator bearer is supplied only through the `OPERATOR_BEARER` environment variable. It is sent in the Authorization header and is never serialized into the evidence bundle or printed.

Use HTTPS for a remote Cloud API. Plain HTTP is accepted only for localhost.

## Collect evidence

Run from an exact checkout of the release under test:

```bash
export PILOT_EVIDENCE_RELEASE_COMMIT=<40-character-release-sha>
export CLOUD_API_BASE_URL=https://api-event.nairobuy.com
export EVENT_ID=<pilot-event-id>
export OPERATOR_BEARER=<operator-session-bearer>

pnpm pilot:event-close:collect artifacts/pilot-evidence/event-close.json
```

Do not paste `OPERATOR_BEARER` into GitHub issues, chat, screenshots or the retained evidence pack.

The collector refuses to proceed if `/health` reports a release other than `PILOT_EVIDENCE_RELEASE_COMMIT`.

## Verify evidence

```bash
export PILOT_EVIDENCE_RELEASE_COMMIT=<same-release-sha>

pnpm pilot:event-close:verify \
  artifacts/pilot-evidence/event-close.json \
  artifacts/pilot-evidence/event-close-verification.json
```

A PASS requires both `controlledPilotCloseSatisfied=true` and `inventoryCloseReconciliationSatisfied=true`.

The verification report always emits `liveMoneyApproved=false`. Passing this gate is necessary evidence, not standalone authorization for live money.

## Controlled-pilot close checks

The verifier fails closed unless:

- the evidence bundle and deployed Cloud health match the exact expected release;
- the live report belongs to the expected event and is `OPERATIONALLY_CLOSED`;
- source truth has not changed since the latest close;
- stored report revisions are contiguous;
- every stored report SHA-256 matches the exact serialized report JSON;
- every stored report's event, source token, revision and report ID are internally consistent;
- the latest append-only action is the close action for the latest stored revision;
- the live report still aligns to that latest immutable stored revision;
- the latest stored CSV export was successfully captured;
- there are no unresolved payment attempts;
- payment-method and provider reconciliation contain no unresolved/unknown/pending truth;
- sales-to-tender reconciliation is conclusive with zero variance;
- at least one closed device transaction exists, so an empty event cannot satisfy the pilot-close gate;
- every cash scope that exists is declared with zero variance and cash summaries are complete with zero variance.

A legitimate non-zero cash variance is operational evidence to review, not something this automated gate silently tolerates. Reconcile or explicitly disposition it through the broader human go/no-go process rather than changing the verifier to make the run green.

## Inventory close checks

The inventory gate fails unless:

- there are no open/unreceived transfers;
- there are no unresolved critical inventory alerts;
- at least one closed physical-count variance row exists;
- every count row records a close timestamp;
- every non-zero physical-count variance has an explicit valuation and unit cost.

A zero quantity variance may remain `MISSING_UNIT_COST` because there is no non-zero variance to value.

## Retention and pilot manifest

Retain both the raw evidence bundle and verification report under the pilot evidence directory. Hash each file with:

```bash
pnpm pilot:evidence:hash <pilot-manifest.json> <evidence-file>
```

Add the resulting digest-bound references to the relevant pilot gates only after a named reviewer has inspected the evidence.

This tooling can support:

- `inventoryCloseReconciliation`;
- `controlledPilotClose`.

Do not mark either gate PASS solely because repository CI is green.

## Failure handling

If the verifier blocks:

1. do not delete or edit stored close revisions;
2. inspect the failed check IDs;
3. reconcile the underlying payment/cash/inventory truth;
4. if source truth legitimately changed after close, use the explicit reopen/correction workflow;
5. create a new immutable close revision;
6. collect a fresh evidence bundle and re-run verification.

Never mutate transaction history or stored report JSON to make the gate pass.
