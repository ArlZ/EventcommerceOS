# Task 010 — Production Hardening & Event Simulation

Status: **feature-complete; final green Task 009 base merged; permanent repository CI revalidation in progress; release still gated by security + real pilot evidence**
Base: final Task 009 (`codex/task-009-event-close` at `bb531f8dc5fcf91cf3a76649e812e275ab88a0d9`)

## Objective

Create release evidence for live-event reliability without adding product features. This task is a pilot gate, not a declaration that the platform is ready for a major festival.

## Evidence layers

1. **Deterministic model simulation** — repeatable fault/load regression in `packages/simulator`.
2. **Repository acceptance tests** — existing TypeScript, integration and Android gates plus Task 010 invariant tests.
3. **Threat-focused review** — payments, callbacks, auth/RBAC, sync, device trust and privileged inventory/close actions.
4. **Real pilot evidence** — supported Android devices, event Wi-Fi/LAN, Edge hardware and sandbox/live provider rails using `docs/PILOT_RUNBOOK.md`.

A pass at one layer does not substitute for the next layer.

## Simulation coverage

The required suite models:

- Cloud outage while local commerce continues;
- Edge-to-Cloud partition and backlog drain;
- one isolated POS followed by reconnect;
- Edge restart under backlog;
- large replay with duplicate and reordered sync delivery;
- delayed, duplicated and reordered provider callbacks;
- provider timeout with explicit uncertainty;
- sudden product demand spike;
- concurrent sales and replenishment transfers;
- operational notification-provider outage independent of payment truth;
- slow Cloud database/dependency;
- application-level WAN failover;
- a combined peak scenario materially above the intended pilot topology.

Configurable dimensions include bars, registers, transaction rate, product mix, opening stock, payment rail mix, network latency/loss, sync duplicate/reorder rate, provider delay/timeout/duplicate rate and fault windows.

## Metrics

Each scenario records:

- generated and locally committed orders;
- lost committed orders;
- modeled local interaction and commit p50/p95/max latency;
- throughput;
- maximum and ending sync backlog plus drain time;
- duplicate sync/provider delivery and duplicate business effects;
- payment UNKNOWN creation and unresolved-at-end counts;
- provider callback latency;
- dashboard/sync-to-view lag;
- notification/dependency errors and error rate;
- stockout attempts;
- transfers created/completed;
- physical/Edge/Cloud inventory convergence and convergence time.

## Hard invariants

The modeled suite fails if any of these occur:

- a locally committed order is lost;
- a duplicate business effect occurs;
- recovery ends with undrained sync backlog;
- payment uncertainty remains unresolved after the configured recovery window;
- completed payment effects do not equal committed modeled sales;
- physical, Edge and Cloud inventory do not converge;
- Cloud order/inventory projections do not converge to durable event truth;
- modeled local p95 interaction exceeds 150 ms or local commit p95 exceeds 250 ms.

The latency assertions are **model regression checks only**. Real hardware must independently prove the SLOs.

## Executed evidence

A strict TypeScript 5.8.3 compile of the simulator source passed in the available execution environment using the repository's core strictness settings.

The deterministic required suite was executed with fixed seeds/timestamp and passed **12/12 scenarios**. The combined above-pilot scenario produced:

- 10 bars × 5 registers;
- 4,200 committed modeled orders;
- 600 modeled orders/minute throughput;
- max sync backlog 3,385;
- 1,233 payment attempts entering uncertainty;
- 1,010 duplicate sync deliveries;
- 577 duplicate provider signals;
- zero duplicate business effects;
- zero unresolved payments after recovery;
- zero remaining sync backlog;
- converged physical/Edge/Cloud inventory.

Full deterministic baseline: `docs/SIMULATION_BASELINE_2026-08-14.md`.

## Security/release review

Documented in `docs/RELEASE_SECURITY_REVIEW.md`.

The review identified release-blocking areas that are being remediated in the later stacked security/reliability PRs: authenticated machine ingress, POS and human identity/RBAC, abuse controls, backup/restore evidence and dependency/SCA evidence. This Task 010 slice must not claim those later controls as part of its own feature scope.

Current security disposition remains **NO-GO for internet-exposed production or a live-money pilot** until the full stack and required operational evidence are complete.

## Repository CI checkpoint

The first real permanent runner pass reached a successful build and then exposed five shared Command Centre/Event Close Nest DI import-hygiene errors. Those dependencies are runtime injection tokens, so the repair preserves runtime class imports with explicit `@Inject(...)` rather than applying unsafe type-only conversion.

The repaired Task 010 tree also carries the already-proven shared Event Close correctness needed by its own existing tests: consistent Command Centre SQL typing, correct CSV response handling, explicit correction-window conflict enforcement, inconclusive financial reconciliation when provider adjustment truth is unresolved, and deterministic serial execution for the Cloud API/Event Edge integration suites that share PostgreSQL/process state.

No later Edge credential, POS identity, human-auth, abuse-control, backup/SCA feature scope was pulled into this PR. The complete repository Prettier surface was normalized as part of the repair.

A fresh permanent TypeScript + Android CI pass on this exact repaired tree is now required before this PR is merge-ready.

## Pilot graduation rule

Task 010 must not mark the product "festival ready". After the security blockers and permanent CI are closed, the maximum recommendation from automated evidence is **controlled pilot candidate**.

Graduation to a larger event requires all of:

- green permanent TypeScript + Android gates on the exact release commit;
- no open P0/P1 security findings;
- supported-device local latency evidence meeting SLOs;
- 100-order offline/restart durability test with zero loss;
- provider sandbox payment fault matrix passed, including timeout/duplicate/late callback cases;
- successful event-network partition/reconnect exercise;
- inventory opening/count/transfer reconciliation with zero unexplained ledger divergence;
- completed backup restore exercise;
- one controlled live pilot closed and reconciled with documented incident/evidence pack;
- explicit human go/no-go review before any materially larger deployment.