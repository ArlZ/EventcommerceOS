# Codex Task 002 — Event, Location & Catalogue Vertical Slice

Read `AGENTS.md`, all relevant docs, the completion record for Plan 001, and inspect the codebase before changing anything.

## Objective

Build the smallest end-to-end administrative slice that creates the domain structure required by a live event:

```text
Organisation -> Event -> Sales Location -> Inventory Location -> Product -> Menu -> Menu Item/Price
```

This task establishes real persistence and contracts but does not yet create sale orders or payments.

## Requirements

- PostgreSQL persistence in cloud API.
- Database migrations under source control.
- Globally unique IDs suitable for offline references.
- Event timezone and lifecycle fields.
- `SalesLocation.type` must be extensible and initially support `BAR`.
- Product/SKU separation where appropriate.
- Menu assignment by sales location.
- Price stored as integer minor units + currency.
- API validation at boundaries.
- Control Web screens sufficient to create/view/edit the above entities.
- Audit event for privileged administrative mutations.
- No hard delete for entities already referenced by business history; use lifecycle/archive semantics.

## Tests

Cover:
- money integer constraints;
- invalid/cross-tenant references;
- duplicate/invalid menu assignments;
- event timezone handling;
- authorization boundaries at a basic scaffold level;
- migrations from empty DB.

## Acceptance path

A developer can:
1. create an organisation/event;
2. create `Main Stage Bar` and `VIP Bar`;
3. create central warehouse and bar inventory locations;
4. create `Tusker 500ml`;
5. create an event menu;
6. price the product differently by location if supported by the chosen model;
7. view the resulting configuration in Control Web.

Document decisions and update/create the execution plan before implementation.
