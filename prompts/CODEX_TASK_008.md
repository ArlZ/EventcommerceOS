# Codex Task 008 — Live Event Command Centre

Read product/UX/inventory/reliability docs and inspect existing telemetry/data models.

## Objective

Build the operational dashboard that helps an event manager act, not merely admire charts.

## First-screen questions

1. Are sales flowing?
2. Which locations are slowing?
3. Which products/locations are at stockout risk?
4. Are payments healthy?
5. Are devices and sync healthy?
6. Which alerts require action now?

## Metrics

- gross sales;
- transaction count;
- average order value;
- current sales velocity;
- performance by sales location;
- top products;
- payment-method split;
- payment pending/unknown/failure rate;
- stock risk/minutes-of-cover;
- active transfers;
- device heartbeat/sync age/backlog.

## Realtime architecture

Use a non-blocking realtime mechanism appropriate to the current stack. Realtime failure must degrade to refresh/polling; it must have zero impact on checkout.

## Alert centre

Critical inventory/payment/device exceptions appear before secondary analytics. Allow authorized acknowledgement/assignment directly from the command centre.

## Tests

- dashboard continues when realtime channel is unavailable;
- stale data is labelled rather than presented as live;
- high event volume does not create one query per register/product (avoid N+1);
- cross-tenant/event data isolation;
- inventory alert actions remain auditable.
