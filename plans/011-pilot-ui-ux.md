# 011 — Pilot operator UI/UX

## Objective

Turn the already-functional Event Commerce OS interfaces into operator-grade pilot surfaces without changing the hardened order, payment, inventory, sync or reconciliation semantics underneath them.

The pilot UI must optimize for speed, scanability, recovery and low training burden. It is not a cosmetic redesign and it is not the final commercial brand system.

## Users and priority jobs

### Bartender / cashier
- recognize device/event readiness immediately;
- find a product with minimal navigation;
- build and correct an order using large touch targets;
- start the intended payment rail quickly;
- understand `PENDING`, `SUCCESS`, `FAILED` and especially `UNKNOWN` without technical knowledge;
- continue ordering safely when cloud connectivity is unavailable.

### Event manager / supervisor
- see what needs attention before reading aggregate metrics;
- understand whether data is live, delayed or stale;
- identify which sales location, device, payment rail or SKU needs intervention;
- acknowledge/assign operational alerts with clear ownership.

### Inventory team
- orient around receive, move, count and investigate workflows;
- see critical stock risk and replenishment recommendations first;
- never confuse a dashboard projection with the append-only stock ledger source of truth.

### Organisation admin
- configure a pilot event as a guided operational sequence rather than by raw domain identifiers wherever the current APIs permit it.

### Finance / event close owner
- work through close in an explicit sequence;
- surface unresolved payments, sync backlog, stock variance and cash/reconciliation exceptions before closure;
- preserve immutable close/revision behavior.

## Design principles

1. Preserve all golden invariants in `AGENTS.md`.
2. No UI request may make the POS checkout path depend on Cloud.
3. Big touch targets, minimal typing and high-contrast payment states on POS.
4. Exceptions before dashboards on Event Control.
5. Human labels before raw identifiers; identifiers remain available when operationally useful.
6. Never present stale/unknown state as healthy or final.
7. Destructive or financially sensitive actions require explicit language and visible consequences.
8. Use a small, dependency-free design system for the pilot; do not add a UI framework merely for styling.
9. Responsive web layouts must remain usable on an operations laptop and a supervisor tablet.
10. Visual polish must not hide auditability, attribution or recovery state.

## Implementation slices

### Slice A — shared Event Control foundation
- shared global tokens and native-control styling;
- persistent product/navigation shell;
- clearer operator-session state;
- task-based Event Control home;
- consistent page headers, surfaces, status pills and focus states;
- no business/API behavior changes.

### Slice B — pilot-critical web workflows
- Command Centre: exception hierarchy, event context, KPI hierarchy, health states;
- Event Setup: guided sequence and reduced raw-ID exposure;
- Inventory: operational task language and risk-first hierarchy;
- Sync Health: device recovery language and clearer degraded states;
- Event Close: checklist/progress hierarchy and hard-to-miss blockers.

### Slice C — Android POS operator pass
- persistent readiness/sync indicator that does not dominate the sale path;
- simplified product/category and basket hierarchy;
- larger primary checkout controls;
- human payment-state messaging;
- remove development-only labels from the pilot surface while retaining safe development behavior behind implementation boundaries;
- provisioning screen separated visually from bartender trading mode.

### Slice D — real-device usability validation
- run the POS on the chosen pilot device size;
- test bright/dim venue conditions and one-handed/two-handed use;
- time item-to-payment-start and common correction flows;
- rehearse offline, reconnect, payment `UNKNOWN`, device restart and credential replacement;
- record usability defects in pilot evidence.

## Acceptance criteria

- all existing functional routes remain available;
- no order/payment/inventory/sync semantics are changed by the UI foundation;
- Event Control has one consistent navigation model and no homepage made of raw text links;
- keyboard focus and touch targets are visibly usable;
- POS preserves local-first behavior and makes electronic-rail degradation non-blocking;
- `UNKNOWN` payment messaging explicitly prevents unsafe repeat charging;
- web build/lint/typecheck/tests/format/architecture checks pass;
- Android unit tests and lint pass for Android UI slices;
- any UI-driven behavioral change receives the tests required by `AGENTS.md`.

## Non-goals for this stage

- final corporate branding;
- consumer ordering;
- animation-heavy marketing UI;
- new payment or inventory capabilities;
- rewriting APIs solely to support visual preferences;
- hiding operational/audit information to make screens appear cleaner.

## Definition of done

Pilot-critical operators can execute their normal workflows with substantially less technical interpretation, and the UI is ready to be tested on real pilot hardware as part of the controlled-pilot runbook.