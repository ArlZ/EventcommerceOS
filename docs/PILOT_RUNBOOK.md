# Event Commerce OS — Controlled Pilot Runbook

Status: **runbook ready; live pilot must not start until the release blockers in `RELEASE_HARDENING.md` are closed.**

This runbook is for a controlled, limited event using supported hardware and known operators. It is not approval for a major festival.

## 1. Go / no-go ownership

Assign before deployment:

- Pilot lead — owns final go/no-go.
- Technical incident lead — owns POS/Edge/Cloud/network incidents.
- Payments lead — owns provider test evidence and `UNKNOWN` reconciliation.
- Inventory lead — owns opening stock, transfers, counts and variance.
- Operations lead — owns device/cashier assignment and physical fallback.
- Finance/reconciliation lead — owns cash declarations and event close.

The pilot lead records the decision and evidence location.

### Hard no-go conditions

Do not open live sales if any of the following is true:

- permanent TypeScript/Android CI has not executed and passed on the intended release;
- authenticated operator sessions/RBAC are not deployed;
- POS device and Event Edge identities cannot be registered and revoked;
- Cloud/Edge sync accepts unauthenticated production senders;
- payment mutation/adjustment endpoints are exposed without the required authenticated caller boundary;
- provider credentials/test callbacks have not been validated;
- no tested backup/restore path exists for Cloud and Event Edge databases;
- local POS durability/restart test fails on the supported device;
- the event network has no working monitoring or fallback path.

## 2. Hardware and network checklist

### POS devices

For every device record:

- asset/serial identifier;
- OS/app version;
- event and sales-location assignment;
- registered device identity/credential;
- battery health and charging plan;
- last successful configuration sync;
- local storage free space;
- local time/timezone sanity;
- lost/stolen device revocation procedure tested.

Keep at least one configured spare POS for the pilot.

### Event Edge

- selected host/mini-server documented;
- UPS/power backup connected and tested;
- PostgreSQL healthy;
- disk capacity/IO monitored;
- application version matches approved release;
- Edge identity credential provisioned and rotatable;
- local event database backup available before opening;
- restart process documented and rehearsed.

### Event network

- POS SSID/VLAN separated from guest/public Wi-Fi;
- AP coverage walkthrough completed at every bar;
- POS→Edge latency/loss sampled from each sales location;
- Edge reachable by stable local address/name;
- primary WAN tested;
- cellular/secondary WAN failover tested where planned;
- networking equipment on UPS where required;
- public inbound access restricted to intentionally exposed Cloud/provider routes;
- Cloud and provider routes use TLS.

### Payment terminals

- terminal ID/merchant account mapped to event/bar where applicable;
- independent terminal connectivity checked;
- Sabi merchant reference procedure rehearsed;
- test receipt/reference can be reconciled to one Event Commerce OS payment attempt;
- no PAN, CVV/CVC, PIN, track or EMV data is typed into or copied into Event Commerce OS.

## 3. Deployment sequence

1. Freeze the release commit/artefact identifier.
2. Confirm permanent CI green and retain links/artifacts.
3. Run dependency/secret/image security scans and retain results.
4. Apply Cloud database migrations in staging/pre-production first.
5. Deploy Cloud API and Control Web.
6. Verify Cloud health, authentication, RBAC, provider configuration and observability.
7. Back up Event Edge database, apply Edge migrations and deploy Edge.
8. Verify Edge health and authenticated Cloud sync.
9. Provision/register POS devices and install the approved app build.
10. Assign event, sales location and operator permissions.
11. Sync configuration/menu and validate checksums/version on every device.
12. Load/confirm opening stock.
13. Run the full pre-open test below.
14. Pilot lead records explicit GO.

Do not hot-fix a single node into a different version during the event unless the incident procedure explicitly approves it.

## 4. Device provisioning procedure

For each POS:

1. Register the physical device with the platform.
2. Issue/store the device credential using the supported secure storage path.
3. Assign organisation/event/sales location/register.
4. Confirm revoked/unknown credentials are rejected by Event Edge.
5. Install the approved menu/configuration snapshot.
6. Verify the last valid menu remains usable with network disabled.
7. Create a non-live test order, confirm local durable state/outbox, then clear/reset the test fixture using the approved environment procedure.
8. Reboot the device and confirm identity/configuration recover correctly.

Never share one device credential across multiple physical POS devices.

## 5. Pre-open acceptance test

Perform before customer sales, using a test event/data boundary where possible.

### Local POS durability

- Disable WAN/Cloud while leaving the POS operational.
- Create at least 100 test orders/committed mutations across supported devices.
- Randomly kill/restart the app after committed actions.
- Confirm every acknowledged local commit remains after restart.
- Confirm UI remains usable while Cloud is unavailable.
- Restore connectivity and confirm exactly-once convergence.

### Sync/replay

- isolate one POS from Edge, continue local transactions, reconnect;
- restart Event Edge with a queued backlog;
- replay a captured/fixture batch twice;
- verify no duplicate order/inventory/payment business effect;
- confirm reconciliation exceptions are explicit for deliberately conflicting input.

### Hardware performance

On the supported pilot device measure and retain:

- product-grid interaction p50/p95/p99;
- local committed mutation p50/p95/p99;
- restart/recovery time;
- outbox drain time after the 100-order offline test.

Engineering target: product interaction p95 <150 ms and local committed mutation p95 <250 ms. Synthetic simulator latency does not satisfy this check.

## 6. Payment test

Test each enabled rail before opening.

### M-PESA

- initiate with a controlled test number/environment;
- verify one durable attempt/idempotency key;
- verify provider timeout leaves `UNKNOWN`, not failed;
- deliver/observe delayed authoritative success and confirm the original attempt resolves;
- replay the callback/notification fixture and confirm one business effect;
- verify amount/reference/currency mismatch is rejected or forced to reconciliation;
- confirm no customer phone is retained where the design says it is transient.

### Pesapal Sabi

- create the durable `pesapal_sabi` attempt;
- use its immutable payment-attempt ID as the merchant reference;
- complete a test-terminal charge;
- verify notification credentials are checked;
- verify independent provider verification occurs;
- verify amount/currency/reference mismatch becomes `UNKNOWN`/manual review;
- duplicate the notification and confirm one settlement effect.

### External terminal fallback

- verify only the dedicated `external_terminal` attempt may be manually approved;
- verify integrated M-PESA/Sabi attempts cannot be manually converted to success;
- verify actor, reason, provider/receipt reference and exact amount/currency are retained;
- verify permission denial for an unauthorized operator.

If any integrated payment remains `PENDING`/`UNKNOWN`, do not instruct the customer to repeat the payment until the first attempt is safely resolved.

## 7. Opening stock procedure

1. Confirm inventory locations and base units.
2. Receive/open stock through ledger-backed movements—never by editing a current-balance number.
3. Record warehouse and each bar allocation.
4. Confirm recipes/components where configured.
5. Review stock projection at Edge and Cloud.
6. Perform a spot physical count on selected high-volume SKUs.
7. Verify critical/minutes-of-cover alerts and notification routing.
8. Confirm responsible inventory actors and runner/transfer permissions.
9. Confirm no unexplained reconciliation exception remains from setup.

## 8. Live monitoring

The operations screen is allowed to lag; checkout is not.

Monitor continuously:

- POS heartbeat/last seen;
- device→Edge outbox/backlog;
- Edge→Cloud backlog and oldest event age;
- Edge/Cloud connectivity;
- Cloud/API and database latency/error rate;
- payment provider availability;
- payment `PENDING`/`UNKNOWN` count, value and age;
- callback rejects/duplicates;
- cash/payment-method sales anomalies;
- critical inventory alerts and minutes of cover;
- in-flight transfers;
- dashboard stale-data indicator;
- disk/power/network state of Event Edge.

Use a named incident channel/log. Record incident start/end, affected locations/devices, actions, actor and evidence links.

## 9. Incident fallback procedures

### Cloud or WAN unavailable

- keep local POS and Event Edge sales operating;
- do not restart healthy POS devices merely because the dashboard is stale;
- confirm Edge backlog is increasing durably;
- mark Control Web data as stale/unavailable;
- payment rails that depend on Cloud/provider connectivity may be unavailable independently;
- restore WAN/Cloud and watch backlog drain/convergence before declaring resolved.

### POS cannot reach Event Edge

- confirm local ordering remains available;
- verify the device is accumulating a durable local outbox;
- check AP/VLAN/Edge reachability;
- move the device only if the operator understands that its unsynced local state stays on that device;
- reconnect and verify complete replay/convergence.

Do not factory-reset or wipe a device with unsynced orders.

### Event Edge restart/failure

- POS devices continue local order capture;
- restart/replace Edge using the documented database recovery procedure;
- verify database/outboxes before restoring ingestion;
- watch device and Cloud backlogs drain;
- compare order/inventory convergence before incident closure.

### Payment provider timeout/unknown

- keep the attempt `UNKNOWN`/`PENDING`;
- query/reconcile through the provider adapter;
- do not mark failed from elapsed time alone;
- do not create a second charge merely to clear the queue;
- escalate aged unresolved attempts to the payments lead with order/attempt/provider references.

### Notification provider outage

- do not stop sales or inventory ledger writes;
- use Control Web/operations screen and manual radio/phone escalation for critical stock alerts;
- preserve notification retry backlog/evidence.

### Database degradation

- identify whether Edge or Cloud is affected;
- if Cloud only, preserve event-local operation and throttle non-essential control/report traffic before transactional paths;
- if Edge is unavailable, POS continues locally while repair/restart proceeds;
- never clear a backlog as an incident shortcut.

### Primary WAN failure

- verify automatic/manual secondary WAN activation;
- record outage and failover timestamps;
- confirm no checkout dependency on the WAN;
- confirm Edge→Cloud backlog begins draining after failover.

## 10. Cash and shift control

For every configured bar/device/cashier scope:

- record opening float using the agreed finance procedure;
- retain cashier/device assignment history;
- at close, count actual cash independently;
- enter the declaration once with actor/reason/idempotency;
- investigate shortage/overage instead of editing expected cash to match the count.

## 11. Event close

Before operational close review:

- unresolved `UNKNOWN`/`PENDING` payments;
- unknown refunds/reversals;
- cash expected vs declared variance;
- open/unreceived stock transfers;
- unresolved critical inventory alerts;
- latest physical counts and unit-cost valuation status;
- sales by bar/device/cashier/payment method;
- Edge/Cloud backlog and reconciliation exceptions.

Operational close may be taken with explicitly unresolved truth if business policy allows, but uncertainty must remain visible. Closing must never convert `UNKNOWN` into success/failure.

Create the immutable close revision and export/store:

- revision number;
- report SHA-256;
- source-version token;
- closing actor/reason/time;
- CSV report;
- action history.

## 12. Post-event reconciliation

1. Wait for/drive device and Edge backlog to convergence.
2. Reconcile every payment `UNKNOWN`/manual-review case.
3. Re-run live close report and check whether source truth changed after the stored close.
4. Resolve payment refund/reversal uncertainty.
5. Complete/resolve transfers.
6. Close physical stock counts and review quantity/value variance.
7. Reconcile cash declarations.
8. If late authoritative truth changes the event, use an audited reopen and create the next close revision; never rewrite revision 1.
9. Retain provider references, exception records and close exports with the pilot evidence pack.

## 13. Evidence collection

Retain at minimum:

- release commit SHA and build identifiers;
- CI links/results;
- dependency/secret/container scan outputs;
- device inventory and assignment list;
- network topology and WAN-failover timestamps;
- POS p50/p95/p99 latency measurements;
- 100-order offline/restart test result;
- Edge restart/backlog drain result;
- provider test evidence without sensitive credentials/card data;
- payment `UNKNOWN` lifecycle samples;
- sync duplicate/replay result;
- inventory convergence and count variance;
- incident timeline;
- final close revision/CSV/hash;
- post-event reconciliation signoff.

Never place provider secrets, raw card credentials or unnecessary customer personal data in the evidence pack.

## 14. Pilot success / graduation criteria

The controlled pilot succeeds only if:

- zero acknowledged committed orders are lost;
- zero duplicate financial/stock business effects occur;
- measured POS latency meets the agreed hardware target or has an approved remediation plan;
- all partitions/restarts converge without data deletion/manual database edits;
- all payment uncertainty reaches a traceable outcome;
- cash and inventory variance are explainable and audit-visible;
- operational close and any reopen/re-close are reproducible;
- no unresolved Sev-1/Sev-2 security or reliability incident remains.

Only after a successful pilot review should the team set a larger-event load target and repeat the hardening exercise materially above that target.
