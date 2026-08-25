# Durability evidence verifier

`pnpm pilot:durability:verify -- <manifest.json> [output.json]` verifies the retained evidence from the controlled-pilot offline/restart/reconnect drill.

It is intentionally narrower than the full Gate B decision. A PASS proves the register-local durability and POS-to-Event-Edge convergence checks encoded below. It **does not** prove that replay caused zero duplicate Cloud sales or inventory effects; that remains a separate reconciliation requirement before Gate B can pass.

## Evidence to retain

For every representative physical POS asset, export the POS diagnostics JSON at four checkpoints described in `docs/POS_FIELD_DIAGNOSTICS.md`:

1. `baseline` — connected, immediately before isolation.
2. `offline` — after the representative offline orders are committed.
3. `afterRestart` — after force-stop/device restart while still isolated.
4. `final` — after reconnect and POS-to-Edge convergence.

Also retain a final Event Edge diagnostics JSON generated after the Edge-to-Cloud backlog has drained.

The verifier requires at least **100 new closed orders in aggregate** across the representative registers. Set a higher `minimumNewClosedOrders` in the manifest when the approved drill calls for one.

## Manifest

Place the manifest next to the retained evidence files. Paths are resolved relative to the manifest.

```json
{
  "schemaVersion": 1,
  "releaseCommit": "0123456789abcdef0123456789abcdef01234567",
  "eventId": "event-01",
  "minimumNewClosedOrders": 100,
  "edgeFinal": "edge-final.json",
  "registers": [
    {
      "assetId": "POS-01",
      "baseline": "POS-01-baseline.json",
      "offline": "POS-01-offline.json",
      "afterRestart": "POS-01-after-restart.json",
      "final": "POS-01-final.json"
    }
  ]
}
```

For a LAN-only isolation drill where the POS can still acknowledge to Event Edge while WAN is down, set `"requirePendingOffline": false` on that register. Do this only when the drill design explicitly expects Edge to remain reachable; otherwise the verifier requires durable unacknowledged POS events at the offline checkpoint.

## Checks

The verifier fails closed unless all applicable checks pass, including:

- every retained snapshot uses schema version 1 and the exact approved release SHA;
- the device identity is stable across checkpoints;
- checkpoint timestamps, closed-order counts and durable local sequences are monotonic;
- restart preserves the offline committed-order count and highest durable local sequence exactly;
- the aggregate representative order count meets the configured minimum;
- final POS acknowledgement reaches the highest durable local sequence;
- final POS pending state is zero;
- final POS-reported Edge backlog is zero;
- final POS sync state has no unresolved error;
- the Event Edge final snapshot matches the approved release/event identity;
- every representative device is present in the Edge snapshot;
- Edge accepted/highest-seen sequences match the final POS durable sequence;
- Edge-to-Cloud backlog is zero;
- event-scoped and host-global unattributed reconciliation exceptions are zero.

The generated report includes a SHA-256 digest and is written mode `0600` by default.

## Run

```bash
pnpm pilot:durability:verify -- \
  evidence/durability-manifest.json \
  artifacts/pilot/durability-evidence.json
```

A failing report exits non-zero. Do not edit evidence files to make a failed drill pass. Investigate the cause, retain the failed evidence/incident record, and repeat the drill deliberately after remediation.

## Gate B boundary

Even when the report status is `PASS`, it always emits:

- `gateBSatisfied: false`
- a `remainingGateBProof` statement requiring independent duplicate replay / Cloud sales / inventory reconciliation.

Gate B may be marked PASS only after the verifier report **and** the separate zero-duplicate-business-effects reconciliation have been reviewed and retained together.
