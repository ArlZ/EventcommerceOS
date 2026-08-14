# Task 010 Executed Simulation Baseline — 2026-08-14

This baseline records one deterministic execution of the Task 010 model suite using the committed scenario seeds.

Execution environment used for this baseline:

- Node.js 22.16.0;
- TypeScript 5.8.3;
- strict source compile using the repository's key TypeScript safety flags;
- deterministic suite timestamp fixed to `2026-08-14T18:00:00.000Z`.

This is **model evidence, not real-device performance evidence**. Permanent repository CI, Vitest, Android tests and real pilot exercises are still required.

## Result

**12/12 modeled scenarios passed all release assertions.**

| Scenario | Committed orders | Throughput / min | Local commit p95 ms | Interaction p95 ms | Dashboard lag p95 ms | Max sync backlog | Unknown created / end | Duplicate sync | Duplicate provider | Errors | Transfers | Notification failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Cloud outage | 468 | 93.6 | 118 | 62 | 114,590 | 408 | 149 / 0 | 0 | 20 | 0.0000 | 0 | 0 |
| Edge → Cloud partition | 468 | 93.6 | 119 | 61 | 159,590 | 552 | 202 / 0 | 0 | 0 | 0.0000 | 0 | 0 |
| Single POS isolated/reconnect | 468 | 93.6 | 118 | 62 | 590 | 42 | 17 / 0 | 0 | 0 | 0.0000 | 0 | 0 |
| Edge restart under backlog | 468 | 93.6 | 118 | 61 | 47,590 | 206 | 65 / 0 | 80 | 0 | 0.0000 | 0 | 0 |
| Large replay/reorder | 1,568 | 313.6 | 118 | 61 | 184,590 | 2,524 | 745 / 0 | 609 | 0 | 0.0000 | 0 | 0 |
| Payment callback disorder | 468 | 93.6 | 118 | 61 | 590 | 0 | 35 / 0 | 0 | 147 | 0.0000 | 0 | 0 |
| Demand spike | 468 | 93.6 | 119 | 61 | 590 | 0 | 0 / 0 | 0 | 0 | 0.0000 | 0 | 0 |
| Sales + replenishment | 468 | 93.6 | 118 | 61 | 590 | 0 | 0 / 0 | 0 | 0 | 0.0000 | 4 | 0 |
| Notification outage | 468 | 93.6 | 119 | 61 | 590 | 0 | 0 / 0 | 0 | 48 | 0.0037 | 0 | 7 |
| Slow Cloud database | 720 | 144.0 | 123 | 64 | 1,590 | 4 | 0 / 0 | 0 | 0 | 0.0187 | 0 | 0 |
| WAN failover | 468 | 93.6 | 120 | 61 | 44,680 | 168 | 61 / 0 | 0 | 0 | 0.0374 | 0 | 0 |
| Combined above-pilot peak | 4,200 | 600.0 | 122 | 64 | 128,590 | 3,385 | 1,233 / 0 | 1,010 | 577 | 0.0045 | 0 | 4 |

## Invariant outcomes

Across every scenario:

- lost committed orders: **0**;
- duplicate business effects: **0**;
- sync backlog at recovery end: **0**;
- unresolved modeled payments at recovery end: **0**;
- completed payment effects equal committed modeled sales;
- physical / Edge / Cloud inventory converged;
- Cloud order/inventory projections converged to durable event truth;
- modeled local interaction p95 remained below 150 ms;
- modeled local commit p95 remained below 250 ms.

## Important interpretation

The very high dashboard/provider lag in partition scenarios is expected: it measures how long remote truth is delayed while local commerce continues. It is not hidden by the passing result.

The baseline proves only that the deterministic model preserves its safety invariants under these configured failures. It does **not** prove:

- Android hardware latency;
- Wi-Fi/LAN stability;
- Event Edge host performance;
- real PostgreSQL saturation behavior;
- provider sandbox/live SLA behavior;
- authentication/security readiness;
- backup/restore readiness;
- a live event can be operated safely.

Those remain gated by `docs/PILOT_RUNBOOK.md` and `docs/RELEASE_SECURITY_REVIEW.md`.
