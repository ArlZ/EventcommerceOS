# Task 010 — Production Hardening & Event Simulation

Status: **feature/security-control implementation complete; permanent CI is executing and core gates have passed; final exact-head CI plus operational/pilot evidence remain outstanding**
Base: Task 009 (`codex/task-009-event-close`)

## Objective

Create release evidence for live-event reliability without adding product features. This task is a pilot gate, not a declaration that the platform is ready for a major festival.

## Evidence layers

1. **Deterministic model simulation** — repeatable fault/load regression in `packages/simulator`.
2. **Repository acceptance tests** — TypeScript, integration, Android and dependency-security gates.
3. **Threat-focused review/remediation** — payments, callbacks, auth/RBAC, sync, device trust, abuse controls and privileged inventory/close actions.
4. **Operational recovery evidence** — executable backup/isolated-restore drill against representative release-candidate data.
5. **Real pilot evidence** — supported Android devices, event Wi-Fi/LAN, Edge hardware, abuse/flood exercise and sandbox/live provider rails using `docs/PILOT_RUNBOOK.md`.

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

## Executed model evidence

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

## Security/release remediation stack

The threat review is documented in `docs/RELEASE_SECURITY_REVIEW.md`. The original code-level blockers have now been addressed in the stacked branches:

- SEC-001 Cloud payment caller separation: Event Edge machine payment traffic authenticated; privileged human payment actions use separate human authorization.
- SEC-002 Event Edge -> Cloud ingress: revocable, tenant-bound Edge machine identity.
- SEC-003 human administration: expiring/revocable operator sessions with database-derived organisation RBAC; caller role/actor headers are not trusted.
- SEC-004 POS -> Event Edge: revocable device identity and server-side event/location assignment, with Android secret storage in Keystore-backed encryption.
- SEC-005 abuse/resource exhaustion: Cloud and Event Edge rate, burst, concurrency, request-size and timeout controls plus explicit distributed-upstream deployment contract.
- SEC-006 recovery evidence: executable consistent-snapshot backup + isolated restore/fingerprint/sequence/RPO/RTO drill.
- SEC-008 dependency evidence: executable exact-release npm + Android/Maven SCA gate using resolved inventories, OSV advisories and exact expiring risk acceptances.

Permanent GitHub Actions execution is now functioning. CI run #445 on 2026-08-15 passed build, lint, typecheck, all repository tests, Android and SCA; the only failure was the repository-wide formatting gate. The accumulated formatting drift was then normalized with the repository's pinned Prettier version. A final consolidated exact-head run is still required before the CI evidence layer is treated as closed.

SEC-006 remains an **evidence mechanism**, not passed recovery evidence by itself. SEC-008 has produced real passing SCA evidence on the stacked code lineage, but the exact release candidate still requires retained PASS evidence and named review/sign-off.

## Remaining mandatory release blockers

Current security disposition remains **NO-GO for internet-exposed production or a live-money pilot**.

The remaining blockers are evidence/environment gates rather than missing anonymous trust boundaries:

1. **SEC-005 deployment evidence** — run the documented flood/abuse exercise on the actual pilot topology and retain upstream distributed-protection evidence if applicable.
2. **SEC-006 restore evidence** — execute the representative backup/isolated-restore drill on the exact release candidate, pass fingerprints/sequence/RPO/RTO checks and obtain named sign-off.
3. **Final exact-head CI evidence** — retain one consolidated run where TypeScript/build/lint/typecheck/tests/format/architecture, Android and SCA all pass on the exact release candidate.
4. **SEC-008 review/sign-off** — retain the exact-release SCA PASS manifest with no unaccepted HIGH/CRITICAL/UNKNOWN finding and obtain named sign-off. Moderate/low findings remain visible and are not silently treated as absent.
5. **Real hardware/network/provider pilot evidence** — complete the durability, payment-fault, network partition/recovery, inventory and close/reconciliation exercises in `docs/PILOT_RUNBOOK.md`.

No PASS artifact should be fabricated or inferred from the existence of a script/workflow definition.

## Validation limitation

The prior GitHub Actions runner-allocation blocker is closed: permanent jobs now receive runners and execute. The remaining CI limitation is evidentiary rather than infrastructural — the final exact release head still needs one consolidated green run after repository formatting normalization and documentation refresh.

The backup/restore and pilot-topology gates require representative databases, hardware, network and provider conditions that are not present in this chat execution environment. Those gates cannot be substituted by synthetic unit/integration evidence.

## Pilot graduation rule

Task 010 must not mark the product "festival ready". After the mandatory evidence gates are closed, the maximum recommendation from automated/review evidence is **controlled pilot candidate**.

A controlled pilot may graduate to a materially larger event only when all of the following are retained and reviewed:

- green permanent TypeScript + Android + SCA gates on the exact release commit;
- no unaccepted HIGH/CRITICAL/UNKNOWN dependency finding;
- no open P0/P1 security finding;
- supported-device local latency evidence meeting SLOs;
- 100-order offline/restart durability test with zero loss;
- provider sandbox payment fault matrix passed, including timeout/duplicate/late callback cases;
- successful event-network partition/reconnect exercise;
- abuse/flood exercise passed without starving local commerce or corrupting payment truth;
- inventory opening/count/transfer reconciliation with zero unexplained ledger divergence;
- representative backup restore PASS evidence and reviewer sign-off;
- one controlled live pilot closed and reconciled with documented incident/evidence pack;
- explicit human go/no-go review before any materially larger deployment.
