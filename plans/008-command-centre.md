# Task 008 — Live Event Command Centre

## Objective

Build an event-manager command centre that prioritizes operational exceptions and answers whether sales, stock, payments, devices and sync are healthy without introducing any dependency into checkout.

## Architecture

- Cloud API exposes one event-scoped snapshot contract assembled from a fixed number of batched SQL aggregates.
- Sales/location/product metrics come from accepted immutable ORDER sync events; unlike currencies are never summed together.
- Payment split uses one successful attempt per logical payment; attempt health remains attempt-based so retries and unresolved truth stay visible.
- Inventory risk/transfer metrics come from existing inventory projections.
- Device health is scoped to devices observed selling in the selected event.
- Inventory acknowledgement/assignment is a Cloud control-plane overlay with append-only audit; Edge RESOLVED state always wins.
- Server-Sent Events provide lightweight invalidation/version updates. The browser falls back to polling when the stream is unavailable.
- Snapshot freshness is explicit. A previously loaded snapshot becomes visibly stale when refreshes fail.

## First screen

1. Sales flow: gross by currency, transaction count, AOV, current velocity.
2. Slowing locations: location sales/velocity and last-sale time.
3. Stockout risk: urgent inventory alerts and minutes of cover.
4. Payment health: rail availability, pending/unknown/failure rates and method split.
5. Device/sync health: heartbeat age and backlog.
6. Action centre: critical inventory/payment/device exceptions before secondary analytics.

## Safety and isolation

- Reuse the existing admin context and organisation-access guard.
- Resolve event ownership before any event aggregate or alert mutation.
- Never let realtime/dashboard failures affect POS, Edge or payment initiation paths.
- Keep alert actions monotonic and auditable; do not rewrite inventory Edge event history.

## Acceptance tests

- realtime failure falls back to refresh/polling and stale snapshots are labelled;
- snapshot query count is fixed and does not grow with register/product volume;
- cross-organisation/event access is rejected;
- alert acknowledgement/assignment is event-scoped, monotonic and append-only audited;
- Edge RESOLVED alert state overrides any older Cloud acknowledgement/assignment overlay;
- payment retries do not inflate settled payment-method totals.
