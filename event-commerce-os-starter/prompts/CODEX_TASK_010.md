# Codex Task 010 — Production Hardening & Event Simulation

Read all reliability/security/acceptance docs and treat this as a release gate, not feature development.

## Objective

Create automated evidence that the system can withstand live-event failure modes and peak load materially above the target pilot.

## Build a simulation harness

Simulate configurable:
- number of bars;
- registers per bar;
- transaction rate;
- product mix;
- stock allocations;
- payment rail mix;
- network latency/loss;
- edge/cloud partitions;
- delayed/duplicate provider callbacks.

## Required scenarios

- cloud outage while event continues;
- edge-to-cloud outage while edge operates;
- POS isolated then reconnects;
- edge restart under backlog;
- large sync replay;
- payment callback duplication/delay/reordering;
- sudden product demand spike;
- concurrent sales + replenishment transfers;
- notification provider outage;
- slow database/degraded dependency;
- WAN failover simulation at application level where feasible.

## Measure

- POS local interaction latency;
- committed order durability;
- throughput;
- sync backlog/drain time;
- duplicate business effects (must be zero for protected operations);
- payment unknown rate under injected faults;
- dashboard lag;
- error rate;
- inventory convergence.

## Security/release review

Run dependency/security checks available in the environment and perform a threat-focused code review of payments, auth, device registration, webhooks, sync and privileged inventory actions.

## Deliverable

Create `docs/PILOT_RUNBOOK.md` covering:
- event hardware/network checklist;
- deployment sequence;
- device provisioning;
- pre-open test;
- payment test;
- stock opening procedure;
- live monitoring;
- incident fallback procedures;
- event close;
- post-event reconciliation;
- log/evidence collection.

Do not declare the platform ready for a major festival solely because automated tests pass. Recommend a controlled pilot and define the evidence required to graduate to a larger event.
