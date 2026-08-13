# AGENTS.md — Event Commerce OS

## Mission

Build a production-grade, event-native commerce platform whose first use case is multi-bar festival operations. Reliability during live sales outranks feature count.

## Required reading before work

Read `README.md`, `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/DOMAIN_MODEL.md`, and the domain document relevant to the requested change. For non-trivial changes, create or update an execution plan under `plans/`.

## Golden invariants

1. POS ordering must remain usable without cloud connectivity.
2. Never acknowledge a sale until it is durably committed to the device's local store.
3. Cloud sync, analytics, telemetry and dashboards must never block the bartender checkout path.
4. Money uses integer minor units and an explicit currency code. Never use floating-point arithmetic for monetary values.
5. Inventory is append-only ledger data. Never mutate a stock-on-hand number as the source of truth.
6. Financial, inventory and audit events are never hard-deleted. Correct them with compensating entries/state transitions.
7. All externally retryable mutations require idempotency protection.
8. Payment attempts use an explicit state machine. Do not infer failure solely from delayed provider callbacks.
9. Raw PAN, CVV, PIN, magnetic-stripe or equivalent sensitive card data must never enter our application logs, stores or APIs.
10. Provider-specific payment logic belongs behind payment adapters. Domain logic must not depend on a specific PSP.
11. Every stock transfer, adjustment, wastage, comp, void and refund must have actor, timestamp, location/device context and reason where applicable.
12. Low-stock and stockout alerts must be calculated per sales location and event-wide. Alerts must support acknowledgement, assignment and escalation.
13. Bar/POS UI must prefer big targets, minimal steps, no unnecessary typing, and clear payment states.
14. Design domain primitives generically: `SalesLocation`, `Product`, `InventoryLocation`; use types such as `BAR` rather than hard-coding bar semantics everywhere.
15. Parse and validate all external boundaries. Never trust provider payloads, clients or sync peers.

## Architecture boundaries

- Domain rules must be testable without network or framework dependencies.
- Persistence adapters implement interfaces owned by the domain/application layer.
- POS local storage is authoritative for unsynced device activity.
- Event Edge is authoritative for event-local coordination while disconnected from cloud.
- Cloud is authoritative for organisation-wide history, configuration and consolidated reporting once synchronization completes.
- Cross-layer dependency direction must be documented and mechanically testable.

## Required test behaviour

For any change touching orders, payments, inventory, sync, authentication, permissions or reconciliation:

- add/update unit tests;
- add/update integration tests;
- add at least one relevant failure-mode test;
- run formatting, linting, type checks and relevant tests;
- review the diff for duplicate charges, lost orders, incorrect stock, privilege escalation and blocking calls on the POS path.

For sync changes, test duplicate, delayed, reordered and replayed messages.
For payment changes, test duplicate requests, duplicate callbacks, late callbacks, provider timeout and recovery.
For inventory changes, test concurrent movements, transfer lifecycle, negative-stock policy and compensating adjustments.

## Coding rules

- Prefer explicit state machines over interacting booleans.
- Prefer boring, well-understood dependencies.
- Keep provider SDKs at system boundaries.
- Use structured logs with correlation IDs, event IDs, order IDs and device IDs where relevant.
- Never log secrets or full customer payment identifiers.
- Migrations must be forward-safe and reviewable.
- New production dependencies must be justified in the plan or task summary.
- Avoid microservices unless a proven operational/scaling boundary requires them.

## Definition of done

A task is not complete until:

1. implementation matches acceptance criteria;
2. tests pass;
3. failure cases are covered;
4. documentation is updated if behaviour or architecture changed;
5. no golden invariant above is violated;
6. a concise summary lists changed files, tests run, open risks and recommended next task.

## Code review rules

Flag as critical:

- any path that can duplicate a charge;
- any acknowledged order that can be lost after process/device failure;
- inventory mutation without ledger entry;
- hard deletion of financial/inventory/audit history;
- raw card data storage/logging;
- cloud dependency in the synchronous POS sale path;
- missing authorization for privileged actions;
- retryable mutation without idempotency;
- payment callback treated as trustworthy without signature/schema validation;
- silent sync conflict resolution that changes money or stock.
