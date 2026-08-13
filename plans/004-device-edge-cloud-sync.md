# Execution Plan 004 — Device → Edge → Cloud Synchronization

## Goal

Move durable POS events from Android devices to Event Edge and onward to Cloud using at-least-once delivery, replay-safe receivers, explicit conflicts, bounded retry and a safe acknowledgement watermark—without introducing any network dependency into the synchronous POS sale path.

## Protocol decisions

### Stable envelope

Every transported event carries schema version, stable event-instance ID, business event ID/type/version, aggregate type/ID, device ID, monotonic device sequence, occurred-at time, idempotency key and payload.

Transport may repeat or reorder envelopes. Receivers must make retries harmless.

### Device → Edge

- Android reads only committed local outbox rows.
- Background sync batches pending rows; ordering is by local device sequence.
- POS sale mutations never wait for sync.
- Edge persists a new event and its cloud-forwarding row in one PostgreSQL transaction before acknowledging it.
- Exact replay of an already-processed event is acknowledged without reapplying its effect.
- A reused `(deviceId, sequence)` or event-instance ID with conflicting content creates a reconciliation exception rather than silently choosing a winner.
- Edge returns the highest contiguous per-device sequence it has safely persisted. Device cleanup/mark-sent uses this watermark only.

### Edge → Cloud

- Edge owns a durable PostgreSQL cloud outbox.
- A background forwarder batches due rows and uses bounded exponential retry with jitter.
- Cloud ingestion is idempotent by event-instance ID.
- Edge marks rows delivered only after Cloud acknowledges them. A crash after Cloud persistence but before the edge mark therefore causes a harmless replay.

### Cloud business effect

Task 004 maintains a minimal synced-order projection for Task 003 order events.

- Each order is bound to the originating device.
- A greater device sequence may advance its projection.
- A late event with a lower sequence is recorded as processed but cannot regress the projection.
- A higher-sequence state regression or cross-device claim for the same order is an explicit reconciliation exception.
- Money is never merged by last-write-wins.

### Sync health

- Device stores last successful edge acknowledgement, acknowledged watermark, pending count and last error locally.
- Edge tracks device contiguous watermark, last seen time and cloud backlog.
- Cloud stores last event arrival/sequence plus the most recently reported edge backlog.
- Control Web reads Cloud API sync-health data; stale age is visible rather than hidden.

## Persistence

### Event Edge PostgreSQL

Use edge-prefixed tables for processed device events, device watermarks, reconciliation exceptions and durable cloud outbox. Edge migration state is separate from Cloud migration state so local/CI environments may safely share one PostgreSQL instance.

### Cloud PostgreSQL

Add processed sync events, synced-order projections, device sync state and reconciliation exceptions through the existing Cloud migration runner.

## Retry policy

Retry uses exponential growth from a short base delay, bounded by a maximum delay, with deterministic/testable jitter injection. Backpressure limits batch size and prevents unbounded immediate retry loops.

## Required automated scenarios

1. deliver the same event 20 times and prove one receiver/business effect;
2. simulate edge persistence followed by lost acknowledgement and prove replay safety;
3. fail cloud transport while new device events continue to be accepted at edge;
4. restore cloud transport and completely drain the durable edge backlog;
5. deliver a later order event before an earlier permissible event and prove the projection does not regress;
6. introduce an unsafe sequence/order conflict and prove a reconciliation exception is persisted;
7. ingest concurrent batches from multiple simulated devices and prove independent monotonic watermarks.

## Non-goals

No Kafka, inventory reconciliation, M-PESA/card work, payment-state synchronization, last-write-wins financial merging, dashboard-to-POS coupling or deletion of durable financial/order history.

## Completion criteria

Task 004 is complete when a committed Task 003 event can be retried from device through edge to cloud without duplicate business effect, edge/cloud outages preserve durable backlog, safe watermarks allow device acknowledgement, conflicts become explicit exceptions, sync health is visible, and the entire Task 001–003 regression gate remains green.