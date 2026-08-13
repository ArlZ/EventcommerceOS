# Execution Plan 002 — Event, Location & Catalogue Vertical Slice

## Goal

Establish the first persisted administrative vertical slice for configuring an event before any orders, payments or stock movements exist.

The accepted end-to-end path is:

```text
Organisation -> Event -> Sales Location -> Inventory Location -> Product -> SKU -> Menu -> Menu Assignment -> Menu Item -> Price
```

## Locked implementation decisions

### Persistence

- Cloud API owns Task 002 persistence in PostgreSQL.
- Use the `pg` driver directly behind a Cloud API database abstraction rather than introducing an ORM at this stage.
- SQL migrations are source controlled under `apps/cloud-api/migrations` and applied by a deterministic migration runner.
- Migration execution records applied migration filenames in `schema_migrations`.
- CI provisions a fresh PostgreSQL service, applies migrations, then runs integration tests.

### Identifiers

- Application code generates UUID identifiers with `crypto.randomUUID()` before persistence.
- IDs are never database sequences and are therefore safe to reference from future offline clients before cloud synchronization.

### Tenancy and authorization scaffold

- All persisted event configuration entities are organisation-scoped.
- Administrative requests carry a minimal Task 002 request context using `x-actor-id`, `x-role`, and, after organisation creation, `x-organisation-id` headers.
- Mutations require an administrative role.
- Cross-organisation references are rejected in application services even where PostgreSQL foreign keys would otherwise permit the reference.
- This is an authorization scaffold only; production identity/authentication remains out of scope.

### Lifecycle and deletion

- Business configuration records use lifecycle/archive semantics.
- No Task 002 HTTP DELETE endpoints will be added.
- Archiving records `archived_at` and preserves identifiers/history.

### Event time

- Event timestamps are persisted as `timestamptz` UTC instants.
- Each event stores its IANA timezone separately for event-local display and future business rules.
- API event timestamps must include either UTC `Z` or an explicit numeric offset; offset-less timestamps are rejected rather than interpreted using server-local time.

### Catalogue

- `Product` represents the commercial product family; `Sku` represents the sellable/stockable variant.
- SKU codes are unique inside an organisation.
- Money is integer minor units plus ISO-style three-letter currency code.
- `Menu` belongs to one event and may be assigned to multiple sales locations inside that same event.
- A menu item references one SKU.
- Menu item pricing supports a default price and an optional sales-location override. A location override is valid only when that location is assigned to the menu.

### Locations

- `SalesLocation.type` is stored as text rather than a PostgreSQL enum so new event commerce location types can be introduced without a destructive enum migration. Task 002 accepts `BAR` at the API boundary.
- Inventory locations are event-scoped for the first vertical slice. Initial types are `WAREHOUSE` and `BAR_STORAGE`, represented as extensible text.

### Audit

- Every privileged administrative mutation appends an `audit_events` row in the same database transaction as the business mutation.
- Audit records include organisation, actor, action, entity type/id and structured change context; secrets are never logged.

## Layering

```text
HTTP controller / request validation
        -> application service
        -> repository/database abstraction
        -> PostgreSQL
```

Domain value rules such as integer money remain framework independent.

## API slice

Task 002 will expose endpoints sufficient to:

- create/view/update/archive organisations;
- create/view/update/archive events;
- create/update sales and inventory locations;
- create/update products and SKUs;
- create/update menus;
- assign menus to sales locations;
- create/update menu items and prices;
- fetch an aggregate event configuration view for Control Web.

## Control Web

Add an Event Setup screen that can execute the acceptance path and view the resulting configuration. It should prioritize legibility and operational correctness over final visual design.

## Test strategy

### Framework-independent tests

- money must be integer minor units and reject floating point values;
- currency validation.

### Cloud API integration tests against fresh PostgreSQL

- migrations apply from an empty database;
- event timezone validation and UTC timestamp persistence;
- offset-less event timestamps are rejected;
- same-tenant references succeed;
- cross-tenant references fail;
- duplicate/invalid menu assignments fail;
- location-specific price overrides require a valid menu assignment;
- basic administrative authorization boundaries;
- mutations append audit records.

### Existing regression gate

Task 001 build, lint, typecheck, tests, formatting, architecture checks and Android checks must remain green.

## Non-goals

- order creation;
- payments or payment SDKs;
- inventory ledger movements or stock quantities;
- production login/session management;
- event-edge replication;
- offline POS configuration sync;
- final Control Web visual design.

## Completion criteria

Task 002 is complete only when a fresh CI PostgreSQL database can be migrated and the acceptance configuration can be created through the Cloud API, represented in Control Web, and all Task 001 gates remain green.

## Completion record — Task 002

Task 002 implements persisted organisation/event configuration, sales and inventory locations, product/SKU catalogue setup, event menus and assignments, default and location-specific integer-minor-unit pricing, organisation tenancy checks and transactional audit records. Control Web exposes the Event Setup workflow at `/configuration` and the home screen links to it.

Final review tightened event-time handling so the API refuses timestamps without `Z` or an explicit numeric offset. Production Cloud API startup now relies on standard TypeScript/Nest `emitDecoratorMetadata` rather than importing the manual injection metadata side effect from `ConfigurationModule`. The existing Vitest setup shim remains test-only because the Vitest transform does not emit TypeScript decorator metadata; the associated lint exception is narrowed to the two constructor-DI files that require runtime class imports.

Final validation must pass in normal read-only CI on the committed branch with frozen dependency installation, a fresh PostgreSQL migration, TypeScript build/lint/typecheck/tests/format/architecture checks, and Android unit tests/lint. No Task 003 scope is included.

Still intentionally out of scope: orders, payments, inventory ledger movements or stock quantities, production identity/session management, Event Edge replication, offline POS configuration sync and final Control Web visual design.
