# Delivery Roadmap v0.1

## Phase 0 — Foundation
- repository and CI;
- architecture enforcement;
- domain primitives;
- local dev environment;
- auth/tenant/event skeleton;
- test harness.

## Phase 1 — Transaction core
- catalogue/menu;
- POS shell;
- local SQLite persistence;
- orders/order items;
- local outbox;
- cloud/edge ingestion.

## Phase 2 — Offline sync
- device/edge/cloud protocol;
- replay/idempotency;
- configuration versioning;
- recovery tests;
- device health.

## Phase 3 — Inventory
- ledger;
- receipts/transfers/counts;
- recipe consumption;
- variance;
- low-stock/minutes-of-cover engine;
- alert routing and replenishment workflow.

## Phase 4 — Payments
- payment abstraction/state machine;
- M-PESA adapter;
- card-terminal adapter;
- unknown-payment reconciliation;
- refunds/reversals where supported.

## Phase 5 — Event Control
- live metrics;
- alert centre;
- device/sync health;
- inventory risk;
- payment health.

## Phase 6 — Finance & close
- event close;
- settlement/reconciliation;
- cash-up where enabled;
- audit exports;
- inventory variance reporting.

## Phase 7 — Hardening
- load/chaos testing;
- operational runbooks;
- monitoring/alerting;
- backup/restore drills;
- supported hardware certification matrix;
- pilot deployment.

## Later
- NFC/QR cashless wallet;
- customer self-order;
- loyalty;
- sponsor/VIP wallet allocations;
- deterministic demand forecasting improvements;
- ML forecasting when sufficient historical event data exists;
- food/merch/vendor modules;
- multi-country payments/tax configuration.
