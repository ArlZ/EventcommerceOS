# Task 010 — Production Hardening & Event Simulation

Status: in progress

## Objective

Create repeatable automated evidence for Event Commerce OS failure-mode invariants and a pilot runbook. This task is a release gate, not feature development.

## Non-negotiable interpretation

- Synthetic simulation may validate durability, replay, idempotency, convergence and fault-handling logic.
- Synthetic latency is **model evidence only**. It does not prove Android hardware, Wi-Fi, Edge hardware, provider or production database SLOs.
- A major-festival readiness claim is explicitly out of scope. Graduation requires a controlled pilot on supported hardware/network/provider rails.
- Fault injection must happen at simulator/dependency boundaries. Production checkout/payment/inventory invariants must not be weakened to make scenarios pass.
- Money/stock effects are deduplicated by stable business/event identity. No last-write-wins shortcut is permitted.
- Provider timeout/delay becomes or remains explicit uncertainty; it is never invented as failure.

## Deliverables

1. Extend `@event-commerce/testkit` with a deterministic configurable event simulator.
2. Model bars, registers, transaction rate, product mix, stock, payment mix and controlled fault windows.
3. Cover required scenarios:
   - cloud outage while local/event operations continue;
   - Edge→Cloud partition;
   - isolated POS and recovery;
   - Edge restart with durable backlog;
   - large replay/backlog drain;
   - delayed/duplicated/reordered payment callbacks;
   - sudden product demand spike;
   - concurrent sales and replenishment transfer;
   - notification provider outage;
   - slow/degraded Edge/Cloud database dependency;
   - application-level WAN failover.
4. Measure/model:
   - local commit latency distribution (clearly synthetic);
   - committed order durability;
   - generated and converged throughput;
   - max/final sync backlog and drain time;
   - duplicate business effects;
   - explicit payment uncertainty rate;
   - dashboard lag;
   - error/fault counters;
   - inventory convergence.
5. Add a release-gate evaluator that distinguishes hard invariant failure from pilot-only evidence still required.
6. Add `docs/PILOT_RUNBOOK.md` with deployment, provisioning, pre-open, payment, stock, monitoring, fallback, close, reconciliation and evidence procedures.
7. Add `docs/RELEASE_HARDENING.md` documenting simulation scope, threat review, security gaps and graduation evidence.
8. Run/document available dependency/security checks. Where CI/runtime cannot execute them, record the blocker rather than treating them as passed.

## Simulator design

The simulator is deterministic from a seed and uses a virtual clock. Each POS owns durable local orders and a durable outbox. Event Edge and Cloud each own processed-event identity sets so duplicate/replayed delivery has one business effect. Inventory effects are append-only projections from unique order/transfer events. Electronic payments own immutable attempts and delayed provider callback signals; callbacks may duplicate/reorder but cannot create a second payment effect.

Fault windows alter connectivity/capacity/latency at boundaries only. A recovery drain period is included after the active scenario so final convergence can be measured independently from peak backlog.

## Release-gate policy

Hard automated failures:

- any locally acknowledged committed order lost;
- any duplicate protected business effect;
- unrecovered sync backlog after a scenario whose fault window has ended and whose configured drain window is sufficient;
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

Task 010 remains stacked and draft until permanent GitHub TypeScript + Android gates execute successfully for the lower stack. No stacked task reaches `main` merely because synthetic simulation passes.
