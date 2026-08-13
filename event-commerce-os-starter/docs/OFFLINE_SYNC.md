# Offline & Synchronization Specification v0.1

## Objective

A bartender must be able to continue building and recording orders during cloud or edge connectivity loss. Synchronization must never duplicate money or stock.

## Device write path

```text
User action
 -> validate locally
 -> begin SQLite transaction
 -> update local domain state
 -> append outbox event(s)
 -> commit
 -> render success/state change
 -> background sync
```

Analytics, cloud calls and telemetry occur after local commit.

## Sync properties

The protocol must tolerate:
- duplicate delivery;
- replay after restart;
- delayed delivery;
- out-of-order delivery;
- temporary edge unavailability;
- temporary cloud unavailability;
- device clock skew;
- device reconnect on another access point.

## Ordering

Use per-device monotonic sequence numbers for diagnostics and gap detection. Do not rely only on wall-clock timestamps for causal ordering.

## Idempotency

Each event has a stable unique event instance ID. Receivers persist processed IDs. Business mutations that can be retried independently also use domain idempotency keys.

## Conflict policy

Safe examples for deterministic merge:
- device heartbeat;
- non-financial UI preference.

Unsafe for last-write-wins:
- order payment truth;
- refunds;
- stock movements;
- transfer receipt;
- stock counts;
- privileged audit actions.

Unsafe conflicts move to explicit reconciliation/exception handling.

## Configuration sync

Menus/prices/configuration are versioned. POS should retain the last valid configuration if newer config cannot be fetched.

Configuration changes during a live event should carry:
- version;
- activation time;
- checksum;
- source actor.

## Offline limits

Ordering can remain fully local. Provider-dependent electronic payments cannot be assumed to work offline unless the provider/terminal explicitly supports an approved offline mode. The product must show payment-rail availability separately from POS availability.

## Test scenarios

At minimum automate:
1. 100 local orders while cloud is unreachable.
2. reconnect and confirm exactly-once business effect.
3. kill POS after commit but before network send.
4. kill POS during transaction before commit.
5. replay the entire outbox twice.
6. deliver events out of order.
7. edge unavailable, then returns.
8. cloud unavailable while edge continues.
9. conflicting stock-count operation requires reconciliation.
