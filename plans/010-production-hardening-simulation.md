# Task 010 — Production Hardening & Event Simulation

Status: **implementation complete; reliability model PASS; live-pilot release BLOCKED by documented trust/security gates and permanent CI execution**

## Objective

Create repeatable automated evidence for Event Commerce OS failure-mode invariants and a pilot runbook. This task is a release gate, not feature development.

## Non-negotiable interpretation

- Synthetic simulation may validate durability, replay, idempotency, convergence and fault-handling logic.
- Synthetic latency is **model evidence only**. It does not prove Android hardware, Wi-Fi, Edge hardware, provider or production database SLOs.
- A major-festival readiness claim is explicitly out of scope. Graduation requires a controlled pilot on supported hardware/network/provider rails.
- Fault injection happens at simulator/dependency boundaries. Production checkout/payment/inventory invariants were not weakened to make scenarios pass.
- Money/stock effects are deduplicated by stable business/event identity. No last-write-wins shortcut is permitted.
- Provider timeout/delay becomes or remains explicit uncertainty; it is never invented as failure.

## Delivered

1. Extended `@event-commerce/testkit` with a deterministic configurable event simulator.
2. Modeled bars, registers, transaction rate, product mix, stock, payment mix, transfers and controlled fault windows.
3. Added Task 010 required scenarios:
   - Cloud outage while local/event operations continue;
   - Edge→Cloud partition;
   - isolated POS and recovery;
   - Edge restart with durable backlog;
   - large replay/backlog drain;
   - delayed/duplicated/reordered payment callbacks;
   - sudden product demand spike;
   - concurrent sales and replenishment transfer;
   - notification provider outage;
   - slow/degraded Edge/Cloud dependency;
   - application-level WAN failover.
4. Added modeled measurements:
   - local commit latency distribution, explicitly synthetic;
   - committed order durability;
   - generated/converged throughput;
   - max/final sync backlog and drain time;
   - duplicate deliveries/business effects;
   - payment `UNKNOWN` rate under faults;
   - dashboard lag;
   - fault/error counters;
   - Edge/Cloud inventory convergence.
5. Added a release-gate evaluator separating hard automated invariants from evidence that only a real pilot can supply.
6. Added a focused 2,500-event replay test independently proving Device→Edge and Edge→Cloud processed-ID boundaries have one business effect after a full duplicate batch.
7. Added `docs/PILOT_RUNBOOK.md` covering hardware/network, deployment, provisioning, pre-open, payments, stock, monitoring, incident fallback, close, reconciliation and evidence collection.
8. Added `docs/RELEASE_HARDENING.md` with the simulator verdict, threat review, release blockers and graduation evidence.
9. Reviewed auth/device trust/webhooks/sync/payment/inventory boundaries and explicitly refused to label the platform pilot-ready while critical trust controls are missing.

## Deterministic simulation evidence

The committed default profile uses 8 bars × 6 registers, 18 generated transactions/second, 120 seconds active traffic plus 120 seconds recovery.

Representative committed-scenario evidence from the implementation review:

- Cloud outage: 2,160 locally durable orders, modeled max backlog ~1,890, modeled drain ~17.1 s, zero duplicate business effects, final backlog zero, inventory converged.
- Edge→Cloud partition: modeled max backlog ~1,800, full convergence after recovery.
- POS isolation: local durable queues accumulate and drain after reconnect.
- Edge restart: backlog survives the restart window and drains afterward.
- Large replay: ~2,070 duplicate deliveries ignored in the scenario with zero duplicate business effects; separate boundary test replays 2,500 stable IDs twice at both Edge and Cloud.
- Payment callback chaos: explicit `UNKNOWN` appears under delay, >2,000 duplicate callbacks are ignored in the deterministic profile, final `UNKNOWN` returns to zero, false failures remain zero.
- Demand spike: target beer SKU becomes the dominant product while convergence continues.
- Concurrent transfer: one transfer business effect, inventory converges.
- Notification outage: notification failures accumulate without affecting commerce/inventory durability.
- Slow dependency: modeled max backlog ~967 and later full drain.
- WAN failover: backlog/dashboard lag build during failover delay then converge.

`evaluateReleaseGate()` returns automated invariant PASS for the committed scenarios. It always retains a non-empty pilot-evidence requirement list.

## Security/release review outcome

### Positive controls confirmed

- transactional local state + outbox;
- replay-safe event identity and explicit sync conflicts;
- payment idempotency and immutable attempt history;
- `UNKNOWN` rather than timer/transport-invented failure;
- M-PESA callback treated as a reconciliation signal;
- Sabi notification credential checking + independent transaction verification;
- raw card-data rejection;
- append-only inventory and close/audit history;
- event-level inventory permission checks;
- HTTPS required for Edge→Cloud sync outside loopback.

### Live-pilot blockers found

A. Cloud operator/admin authority currently trusts caller-supplied actor/role/organisation headers instead of a verified session/token.

B. Device→Edge and Edge→Cloud sync authenticate envelope shape/idempotency but not the sender; no production device/Edge enrollment + revocation identity boundary is implemented.

C. Privileged Edge inventory actions parse `actorId` from request bodies; the permission table is real but caller identity is spoofable until a session/device authority supplies it.

D. Cloud/Edge operational payment mutation/read routes need authenticated registered-device/operator boundaries; inner idempotency/permission rules do not replace caller authentication.

E. No reviewed rate/abuse-control layer is present for publicly reachable provider/auth/operational routes.

These are documented as hard pilot blockers in `docs/RELEASE_HARDENING.md`.

## Validation status

- Task 010 TypeScript simulator source was mechanically compiled in an isolated Node 22 / TypeScript 5.8 environment during implementation.
- The deterministic 11-scenario suite executed successfully in that isolated environment.
- The permanent repository GitHub Actions gate remains externally blocked: rerun jobs terminate before step 1 with empty step lists/no job log, consistent with the existing account-level billing/spending issue.
- A network-backed authoritative package vulnerability audit was not available from the current execution environment and is therefore **not claimed as passed**.

Before pilot retain evidence for at least:

```text
pnpm install --frozen-lockfile
pnpm audit --prod
pnpm check
./gradlew test lint
```

plus the deployment secret/image scanners and actual Android/network/provider/backup rehearsals described in the runbook.

## Release-gate policy

Hard automated failure remains any of:

- acknowledged local committed order lost;
- duplicate protected business effect;
- unrecovered backlog after a recovery-capable scenario;
- Edge/Cloud inventory mismatch after convergence;
- payment uncertainty silently converted to definitive failure;
- notification failure affecting order/inventory durability;
- dashboard/fault path creating a synchronous checkout dependency.

Pilot-only evidence still required even when simulation passes:

- p95 product interaction and local commit latency on supported Android hardware;
- real AP roaming/interference behavior;
- Edge restart/recovery on selected event hardware;
- provider sandbox/test-terminal behavior and callback timing;
- primary WAN/cellular failover behavior;
- backup/restore rehearsal;
- operator usability under live load.

## Stack / merge discipline

Base: `codex/task-009-event-close` / PR #11.

Task 010 must remain stacked/draft until the lower-stack permanent TypeScript + Android gates actually execute and pass. It must not reach `main` merely because the deterministic simulation passes.

## Recommended next slice

**Task 011 — Identity, Device Trust & Pilot Security Gate** should close the live-pilot blockers before additional product features are added:

- authenticated operator sessions/tokens and server-derived RBAC context;
- device enrollment/assignment/revocation and authenticated POS→Edge sync;
- authenticated Event Edge service identity for Edge→Cloud sync;
- trusted actor propagation for inventory/payment/close actions;
- route classification and rate/abuse limits;
- security acceptance tests for spoofing, revoked credentials, tenant/event/device isolation and audit attribution.
