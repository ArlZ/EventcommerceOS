# Security & Reliability Baseline v0.1

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
- No raw card credential storage/logging.

## Reliability targets

Initial engineering SLO targets to validate in real hardware testing:

- Local product-grid interactions: perceived instant; target p95 < 150 ms.
- Creating/committing a local order mutation: target p95 < 250 ms on supported devices.
- Cloud outage: no interruption to order building/capture.
- Edge outage: device retains local order capability and queues sync.
- Crash/restart: committed local orders recover.
- Duplicate sync replay: no duplicate business effect.
- Duplicate payment retry/callback: no duplicate business effect.

Electronic payment completion time depends on the external rail; the UI must remain responsive while truth is pending.

## Chaos scenarios before live pilot

- disconnect cloud WAN;
- disconnect edge from cloud;
- isolate one POS from edge;
- restart POS after local commit;
- restart edge under load;
- duplicate/reorder sync events;
- duplicate/delay payment callbacks;
- simulate provider timeout;
- exhaust a popular product at one bar;
- create simultaneous transfer and sales activity;
- slow database queries;
- lose one WAN provider;
- reconnect after a large offline backlog.

## Load test model

Build a simulator that can represent many POS devices and bar locations. A later pre-production gate should test materially above the target event's expected peak throughput, not merely average load.
