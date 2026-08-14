# Task 010 — Production Hardening & Event Simulation

Status: **feature-complete at code/review level; release blocked by security + permanent CI**
Base: Task 009 (`codex/task-009-event-close`)

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

Release-blocking findings include:

- Cloud payment mutation/read surfaces lack production authentication;
- Cloud sync ingestion/device-health surfaces lack authenticated Edge identity;
- admin role/organisation context currently trusts caller-supplied headers;
- device registration/revocation is not production-grade end-to-end;
- rate limiting/abuse controls are not wired globally;
- backup/restore evidence has not been executed;
- dependency/SCA evidence is incomplete;
- permanent GitHub Actions still fails before step 1 and therefore provides no code validation signal.

Current security disposition: **NO-GO for internet-exposed production or a live-money pilot**.

## Validation limitation

The local execution environment has Node.js 22 and TypeScript 5.8.3, but cannot reach the npm registry to activate/download pnpm. Therefore the full workspace build/lint/Vitest/dependency-audit commands could not be substituted locally.

The permanent GitHub TypeScript/Android workflow was retried again during Task 010 and both jobs still completed with zero executed steps. No stack is eligible for merge until those jobs actually run and pass.

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
