# Command Centre Pulse + Ledger redesign

## Context

A live UI simulation exposed several trust and hierarchy failures in Event Control:

- Readiness returns 401 because its configuration request omits the selected organisation scope.
- Event Close can visibly show a selected event while its parent client remains unhydrated from session context.
- Command Centre and Sync Health derive device state independently and can contradict each other.
- The live Command Centre is organised as repeated cards and duplicated summaries rather than a high-pressure action surface.
- Operational values leak technical codes, raw identifiers, inconsistent units and database precision.

## Product thesis

Use **Pulse + Ledger**:

- Pulse: live event operations are temporal, moving and spatial.
- Ledger: revenue, payment and inventory truth must remain exact, calm and auditable.

The Command Centre must let an operator answer within seconds:

1. Is the event trading?
2. How is it performing?
3. What could interrupt trading?
4. What needs action now?
5. What is the current venue/cloud truth?

## Scope

### Trust fixes

1. Add organisation scope to Readiness configuration requests and expose retry/session-expired recovery.
2. Make Event Close context propagation explicit between the context switcher and close client; never style "not loaded" as success.
3. Create one Cloud device operational-status contract and use it in Command Centre and Sync Health.
4. Standardise operator-facing age, duration, status and numeric formatting.

### Command Centre V1

1. Replace the large event context card with a compact event status spine.
2. Add explicit event phase, elapsed/remaining time and data freshness.
3. Add Venue Edge / Cloud Mirror truth bar without implying Cloud delay stops local selling.
4. Add a real 5-minute-bucket sales pulse series from Cloud truth for charting.
5. Make Trading Pulse the dominant analytical surface.
6. Replace duplicated health summaries with one compact operational metric strip.
7. Build a severity-ranked action rail using plain-language incident copy.
8. Build a venue location-health matrix from sales, payments, device health and inventory risk.
9. Show inventory risk, payment health, device exceptions and product ranking as domain-specific visual forms.
10. Keep full technical detail in drill-down screens rather than the live command surface.

## Data/API changes

- Extend Command Centre contracts with sales-pulse points.
- Extend payment health with explicit succeeded count/rate.
- Extend location metrics with payment success, till health, lowest cover and issue count.
- Extend DeviceCloudStatus with server-derived operational status/sync age while preserving existing fields.
- No database migration required.

## Security / architecture

- No POS path changes.
- No payment-provider state machine changes.
- No stock mutation changes; inventory remains append-only ledger-derived.
- Dashboard calculations remain Cloud-side and cannot block selling.
- Existing operator authorization remains server-side.
- No new production dependencies.

## Tests

- Unit tests for shared device-status classification including stale heartbeat with zero backlog.
- Integration coverage that Command Centre and Sync Health APIs expose the same device status.
- Command Centre integration coverage for sales pulse, payment success and location health.
- Control Web readiness request/context recovery tests where practical through existing test structure.
- Formatting, lint, typecheck, build and repository CI.

## Acceptance

Using the isolated simulation event, an operator should be able to identify in the first viewport:

- event phase/time/freshness;
- revenue, velocity, order rate and AOV;
- overall payment success/unresolved value;
- tills reporting and queued sales;
- top actionable incidents;
- venue location comparison;
- critical stock risk.

No synthetic UI data is release evidence and `liveMoneyApproved=false` remains unchanged.
