# Architecture v0.1

## 1. Architectural goal

No single cloud/network failure should stop bartenders from building orders. Provider-dependent payment rails may degrade independently, but the POS must remain responsive and preserve order/payment state accurately.

## 2. Topology

```text
Android POS (SQLite)
      |
      | dedicated local event network
      v
Event Edge (PostgreSQL + sync services)
      |
      | internet when available
      v
Cloud API (PostgreSQL)
      |
      +--> Control Web / HQ
      +--> Payment providers
      +--> Notification providers
      +--> Observability
```

### POS
- Kotlin + Jetpack Compose.
- SQLite for durable local data.
- Local outbox for sync events.
- UI reads local state first.
- Background synchronization.

### Event Edge
- TypeScript/NestJS initially.
- PostgreSQL.
- Local event configuration cache/replica.
- Event-local order ingestion and stock coordination.
- Sync relay to/from cloud.
- Local health endpoint and operations UI hooks.

### Cloud
- NestJS/TypeScript modular monolith initially.
- PostgreSQL as source of consolidated organisational truth.
- Next.js control web.
- Redis only for cache/ephemeral coordination, never money or stock source-of-truth.

## 3. Modular monolith before microservices

Start with strong modules and explicit interfaces:

- Identity & Access
- Organisations & Events
- Catalogue & Pricing
- Orders
- Payments
- Inventory
- Sync
- Devices
- Alerts & Notifications
- Reporting & Reconciliation
- Audit

Extract services only when operational evidence justifies it.

## 4. Data ownership

### Device
Authoritative for unsynced local mutations created on that device.

### Event Edge
Authoritative for event-local coordination during cloud disconnection, subject to deterministic sync rules.

### Cloud
Authoritative for consolidated organisation history and configuration after successful synchronization.

Conflicts involving money or stock must never be silently resolved by last-write-wins.

## 5. Event/outbox pattern

Every important mutation should write business state and an outbox record in one local transaction.

Example event envelope:

```json
{
  "event_id": "uuid",
  "event_type": "ORDER_CREATED",
  "aggregate_type": "ORDER",
  "aggregate_id": "uuid",
  "event_version": 1,
  "device_id": "uuid",
  "event_instance_id": "uuid",
  "sequence": 1842,
  "occurred_at": "RFC3339 timestamp",
  "idempotency_key": "string",
  "payload": {}
}
```

The receiving peer persists processed-event identity so replay is safe.

## 6. Consistency philosophy

- Strong local consistency for creating a sale on the device.
- Strong transactional consistency for money/inventory ledger writes within one store.
- Eventual consistency between device, edge and cloud.
- Explicit reconciliation when cross-node state cannot be automatically merged safely.

## 7. Realtime dashboard

Dashboard data can lag slightly; checkout cannot.

Use event streams/websockets/SSE for live operational updates. If realtime transport fails, degrade to polling without affecting POS.

## 8. Network design assumptions

Production deployments should plan for:

- separate POS network from public Wi-Fi;
- primary WAN plus cellular failover for larger events;
- UPS for critical network/edge equipment;
- monitoring of access points, edge server and WAN;
- payment terminals with independent connectivity where supported.

The application must still assume network partitions will happen.

## 9. Observability

Instrument with OpenTelemetry-compatible traces, structured logs and metrics.

Minimum operational signals:
- API latency/error rate;
- DB latency/pool saturation;
- outbox backlog;
- device sync age;
- edge/cloud connectivity;
- payment-provider latency/status;
- unknown payment count/value;
- stock alert count/age;
- device heartbeat/battery where available.

## 10. Recovery

- POS restart restores open/pending orders from SQLite.
- Sync resumes from durable outbox.
- Duplicate events are ignored safely.
- Event Edge restart rebuilds working state from PostgreSQL.
- Cloud recovery accepts replay without financial/inventory duplication.
