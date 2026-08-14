# Task 010 Simulation Evidence

## What this harness is

`packages/simulator` is a deterministic, seed-driven discrete-event regression harness for Event Commerce OS failure invariants.

It models:

- bars/register topology;
- transaction generation and product mix;
- physical stock, Event Edge inventory projection and Cloud inventory projection separately;
- local durable order commit before remote sync;
- POS -> Edge and Edge -> Cloud queues;
- network partition/loss/latency;
- Edge restart;
- sync replay/duplicate/reorder delivery;
- electronic payment `PENDING`/`UNKNOWN` and delayed provider truth;
- duplicate provider signals;
- demand spikes and replenishment transfers;
- slow Cloud dependency/backlog drain;
- sync-to-command-centre lag.

The required suite is deterministic for a given seed so a regression is reproducible.

## What it is not

This is **not** a hardware benchmark, network emulator, provider certification environment or proof of PCI/security compliance.

The modeled local latency distributions exist only to catch accidental coupling of local interaction/commit behavior to remote faults. They do not prove a particular Android device meets the SLO.

Real device, LAN/Wi-Fi, Edge host, Cloud database and payment-provider measurements are mandatory under `docs/PILOT_RUNBOOK.md`.

## Required suite

| Scenario | Primary evidence |
|---|---|
| Cloud outage | local commit continues; backlog accumulates and drains |
| Edge-to-Cloud partition | Edge/local activity continues; Cloud converges after reconnect |
| Single POS isolation | device queue survives isolation and later converges |
| Edge restart under backlog | restart does not duplicate durable effects |
| Large replay | duplicate/reordered sync has one business effect |
| Payment callback disorder | timeout/delay/duplicate/reorder preserves one payment effect and explicit uncertainty |
| Demand spike | stock exhaustion pressure is visible without projection corruption |
| Concurrent replenishment | physical/Edge/Cloud inventory converge after transfer + sales |
| Notification outage | dependency degradation is measurable and does not become order loss |
| Slow Cloud database | backlog/error metrics degrade without local latency coupling |
| WAN failover | temporary WAN loss grows/retries backlog and converges |
| Combined above-pilot peak | mixed faults at a topology materially larger than the intended controlled pilot |

## Core release assertions

Every modeled scenario fails if:

- any locally committed order is lost;
- duplicate/reordered delivery creates a duplicate business effect;
- sync backlog remains after the configured recovery period;
- injected payment uncertainty remains unresolved after recovery;
- physical, Edge and Cloud inventory do not converge;
- Cloud order/inventory projections do not converge to durable event truth;
- modeled local interaction p95 exceeds 150 ms;
- modeled local commit p95 exceeds 250 ms.

Dependency errors, callback delay, dashboard lag and stockout attempts are measurements, not automatically hidden by a passing invariant result.

## Running

The package is part of the monorepo workspace, so the permanent TypeScript gate runs its build/lint/typecheck/tests.

After a successful build, emit the machine-readable suite result with:

```bash
pnpm --filter @event-commerce/simulator simulate
```

The process exits non-zero if any release assertion fails.

## Evidence interpretation

A green simulation suite means the deterministic model has not found an invariant regression under the configured faults. It does **not** mean the product is live-event ready.

The release disposition must also consider:

- permanent CI on the exact commit;
- Task 010 security blockers;
- dependency/SCA results;
- real supported-device latency/durability;
- network/Edge partition tests;
- provider sandbox fault matrix;
- backup/restore evidence;
- a controlled live pilot and reconciled close.
