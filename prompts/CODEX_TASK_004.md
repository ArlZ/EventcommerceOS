# Codex Task 004 — Device -> Edge -> Cloud Synchronization

Read `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/OFFLINE_SYNC.md` and existing implementation.

## Objective

Implement durable synchronization of POS business events from device to Event Edge and onward to Cloud, with replay safety and explicit exception handling.

## Required behaviour

- Stable event envelope and schema versioning.
- Per-device monotonic sequence for diagnostics/gap detection.
- Stable event instance IDs.
- Receiver-side processed-event persistence.
- At-least-once transport with idempotent business effect.
- Durable edge outbox to cloud.
- Acknowledgement/watermark protocol sufficient for safe cleanup policy.
- Backpressure/retry with bounded exponential strategy and jitter.
- Device sync-health status visible locally.
- Cloud/control view can show device last-sync age and backlog.

## Do not

- use last-write-wins for money or inventory;
- introduce Kafka just for this task;
- make dashboard freshness block POS.

## Required automated scenarios

1. deliver the same event 20 times -> one business effect;
2. kill edge after persist but before ack -> replay safe;
3. disconnect edge from cloud while devices continue syncing to edge;
4. restore cloud and fully drain backlog;
5. reorder permissible events and prove outcome;
6. detect unsafe conflict and create explicit reconciliation exception;
7. run a multi-device simulator sufficient to exercise concurrent ingestion.

Document the sync protocol clearly enough that another engineer can implement a compatible client.
