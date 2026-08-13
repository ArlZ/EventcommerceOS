# Codex Task 003 — Locally Durable POS Order Core

Read `AGENTS.md`, `docs/OFFLINE_SYNC.md`, `docs/UX.md`, relevant plans and existing code.

## Objective

Implement the first real POS sale-building flow **without real electronic payment integration**.

A device must be able to download/seed a versioned event menu, lose all network connectivity, create orders durably in its local database, restart, and still retain those orders.

## POS requirements

- Kotlin + Jetpack Compose.
- Local Room/SQLite persistence.
- Locally generated immutable order IDs.
- Order/order-item state machine consistent with `DOMAIN_MODEL.md`.
- Product grid optimized for touch and speed.
- Category/favourites-ready structure.
- Add/remove quantities and clear order.
- A `Record Cash Payment` dev/test path may be implemented to allow closing a transaction without external provider dependency.
- Local transaction history.
- Durable local outbox written in the same DB transaction as relevant domain state.

## Hard rule

The UI may display success only after the local SQLite transaction commits. No cloud/edge call is permitted on the synchronous success path.

## Failure tests

- network unavailable before order creation;
- process killed after commit before sync;
- process killed before commit;
- repeated taps/double-submit protection;
- app restart with open and closed local orders;
- corrupt/invalid menu update rejected while last valid version remains usable.

## Acceptance demonstration

With cloud and edge intentionally stopped:
1. open POS;
2. use cached menu;
3. create and close 100 test cash orders;
4. restart app several times during test;
5. demonstrate no acknowledged order is lost.
