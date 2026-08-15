# Security & Reliability Baseline v0.2

## Security

- TLS for network transport.
- Encrypted sensitive local storage where platform support allows.
- Short-lived access tokens and secure refresh strategy.
- Device registration and revocation.
- Role-based access control.
- Step-up/supervisor approval for configured actions.
- Provider secrets kept in managed secret storage, never client apps.
- Webhook authentication/signature validation.
- Structured audit trail for privileged actions.
- Rate limiting and abuse controls on public endpoints.
- Database backup and tested restore procedures.
- Least collection/retention of customer personal data.
- Raw card credentials are not accepted by Event Commerce OS payment command models or persisted/logged. PAN/card number, CVV/CVC, PIN, track/magstripe data, EMV payloads and cryptograms remain inside the certified payment terminal/provider boundary.
- Payment command endpoints use strict field allowlists so arbitrary terminal/card payload data is rejected rather than silently carried through the application.
- Manual terminal confirmation requires explicit `PAYMENT_MANUAL_CONFIRM` permission plus actor identity, amount/currency match, external provider/reference, outcome and reason. Every successful manual confirmation creates immutable evidence and an append-only audit event.
- Manual approval cannot overwrite an integrated provider attempt. An integrated `UNKNOWN` payment must be reconciled rather than manually converted to success. For the documented Pesapal Sabi wireless decline gap, only a supervised reference-less `DECLINED` evidence record is permitted; a later verified success becomes an explicit conflict/manual-review case.
- Payment-rail availability is separate from POS/local-order availability. A degraded/unconfigured electronic rail must not disable product entry or other local ordering operations.
- This architecture reduces card-data exposure but does not itself establish PCI DSS compliance or a particular PCI scope. Compliance obligations must be assessed for the selected acquirer, terminal, merchant configuration, network and deployment architecture.

## Reliability targets

Initial engineering SLO targets to validate in real hardware testing:

- Local product-grid interactions: perceived instant; target p95 < 150 ms.
- Creating/committing a local order mutation: target p95 < 250 ms on supported devices.
- Cloud outage: no interruption to order building/capture.
- Edge outage: device retains local order capability and queues sync.
- Electronic payment rail outage/unconfigured state: local order building remains available; no avoidable payment attempt is created merely because rail health cannot be established.
- Crash/restart: committed local orders and unresolved payment attempts recover.
- Duplicate sync replay: no duplicate business effect.
- Duplicate payment initiation/retry/callback: no duplicate business effect.
- Provider timeout or lost acknowledgement: payment truth becomes/stays explicit `UNKNOWN`; the platform never invents a decline.
- Terminal/provider truth received after POS/app disconnect: the original payment attempt can still be correlated and resolved without creating a second charge.

Electronic payment completion time depends on the external rail; the UI must remain responsive while truth is pending. Payment-rail health must be presented independently from general POS availability.

## Chaos scenarios before live pilot

- disconnect cloud WAN;
- disconnect edge from cloud;
- isolate one POS from edge;
- restart POS after local commit;
- restart POS/app while a Sabi payment is pending, then deliver the verified terminal result;
- restart edge under load;
- duplicate/reorder sync events;
- duplicate/delay payment callbacks;
- deliver an authenticated provider callback before Cloud has created the matching payment attempt;
- simulate provider verification timeout followed by delayed authoritative success;
- send a forged/incorrectly authenticated Sabi callback;
- record supervised Sabi decline evidence and then deliver a conflicting verified success;
- make payment-rail health unavailable while repeatedly editing/building a local order;
- simulate provider timeout;
- exhaust a popular product at one bar;
- create simultaneous transfer and sales activity;
- slow database queries;
- lose one WAN provider;
- reconnect after a large offline backlog.

## Load test model

Build a simulator that can represent many POS devices and bar locations. A later pre-production gate should test materially above the target event's expected peak throughput, not merely average load.
