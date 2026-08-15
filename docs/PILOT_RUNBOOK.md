# Event Commerce OS — Controlled Pilot Runbook

Version: Task 010 release gate

## Purpose

This runbook is the operational checklist for proving Event Commerce OS on real supported hardware before any large event deployment.

Passing automated tests or the simulation suite is not enough. A pilot is successful only when the evidence pack proves local durability, payment safety, inventory convergence, operational visibility and recoverability under the actual devices/network/provider setup.

## 1. Pilot scope and go/no-go ownership

Before deployment record:

- event name/date/venue;
- expected attendance and service window;
- number of bars/sales locations;
- registers per bar and spare devices;
- Edge hardware model and spare/restore path;
- LAN/Wi-Fi topology and WAN providers;
- payment rails enabled;
- expected peak transactions per minute;
- opening stock and replenishment model;
- Cloud abuse deployment mode (`single_instance_pilot` or `upstream_distributed`);
- effective Cloud/Event Edge sustained-rate, burst and concurrency ceilings;
- named event operations lead;
- named technical incident lead;
- named finance/reconciliation owner;
- named inventory owner;
- provider escalation contacts.

A single named incident lead owns the technical go/no-go decision. Commercial pressure must not override a failed safety gate.

## 2. Hardware and network checklist

### POS devices

For every supported Android POS device:

- asset/device ID recorded;
- OS/app version recorded;
- battery health and charger/power bank checked;
- local clock/timezone correct;
- app can cold-start without WAN;
- active event/menu cached locally;
- local database survives force-stop/restart;
- spare device is provisioned and tested.

### Event Edge

- Edge host/serial recorded;
- PostgreSQL service healthy;
- disk free-space threshold checked;
- system clock synchronized;
- restart procedure tested;
- local LAN address reserved/static;
- backup config/export path verified;
- physical power/UPS arrangement checked.

### LAN/Wi-Fi

- dedicated event operations SSID/VLAN where possible;
- POS-to-Edge reachability tested from every bar;
- roaming between APs tested where relevant;
- DHCP capacity exceeds device count with headroom;
- local DNS/addressing dependency understood;
- packet-loss/latency sample captured from each location;
- WAN loss does not break POS-to-Edge LAN path;
- primary and fallback WAN documented if used.

## 3. Deployment sequence

1. Deploy Cloud API/control-web release candidate.
2. Apply Cloud migrations and capture migration output.
3. Deploy Event Edge release candidate.
4. Verify Edge database migration/state.
5. Configure organisation/event/sales locations/inventory locations/menu/prices.
6. Configure inventory opening quantities and responsibility routing.
7. Configure payment provider sandbox/pilot credentials through managed runtime secrets only.
8. Confirm abuse deployment mode, trusted-proxy setting and effective HTTP/rate/burst/concurrency limits.
9. Provision POS devices and activate the event/menu.
10. Run pre-open functional test from every sales location.
11. Run fault and abuse-control tests before opening real service.

Do not introduce unreviewed code/config changes after the pre-open evidence pack is signed off.

## 4. Device provisioning evidence

For each device capture:

- device/register identifier;
- assigned sales location;
- assigned event/menu version;
- operator/supervisor access test;
- local order creation test;
- offline order creation test;
- reconnect/sync test;
- restart recovery test;
- electronic payment rail availability display;
- timestamp of successful pre-open validation.

Any device that fails durability/restart/reconnect validation is removed from service.

## 5. Pre-open commerce test

Run at least one order per device:

- add/remove line items;
- verify price/currency;
- complete cash sale;
- verify local order persists after app restart;
- verify order reaches Edge/Cloud;
- verify command centre shows the location/device transaction;
- verify inventory movement occurs once;
- replay/retry sync where possible and confirm no duplicate business effect.

Then run the Gate B durability exercise on representative devices:

1. disconnect WAN/Cloud while preserving local operation;
2. create at least 100 committed orders across supported devices;
3. force-stop/restart selected POS apps after random committed operations;
4. restore connectivity;
5. prove zero acknowledged committed orders lost;
6. prove duplicate replay creates zero duplicate sales/inventory effects.

### Abuse-protection release gate

Run the full exercise in `docs/ABUSE_PROTECTION.md` before live money. At minimum prove:

- sustained invalid/public Cloud traffic reaches `429` without exhausting normal event operations;
- the immediate burst ceiling engages before a full minute allowance can arrive at once;
- the per-policy in-flight ceiling rejects excess concurrent work rather than allowing unbounded handler concurrency;
- a runaway test POS is throttled at Event Edge while a second registered POS remains usable;
- provider callback bursts do not create duplicate business effects and delayed truth still reconciles correctly;
- Cloud flooding or throttling does not prevent local POS -> Event Edge order/cash operation;
- fake operator-session traffic is throttled before it can create unbounded operator-authentication database work;
- the effective deployment mode, trusted-proxy setting and upstream distributed controls (when applicable) are retained as evidence.

This gate fails if abuse protection changes payment truth, causes duplicate commerce effects, or protects Cloud by making local event ordering unavailable.

## 6. Payment test matrix

Use provider sandbox/test mode before live money.

For every enabled electronic rail prove:

- successful initiation and settlement;
- duplicate initiation/idempotency replay;
- duplicate callback/webhook;
- delayed callback;
- provider/API timeout;
- lost acknowledgement producing explicit `UNKNOWN`, not invented failure;
- late authoritative success resolving the original attempt;
- POS/Edge restart while payment is unresolved;
- mismatched/invalid callback rejected;
- no second automatic charge is created while prior truth is unresolved;
- refund/reversal path only where provider capability is explicitly implemented;
- provider health degradation does not disable local order building.

For Pesapal Sabi, keep card data wholly inside the certified terminal/provider boundary. For M-PESA, retain only the provider-neutral payment truth and permitted identifiers.

Do not use production credentials until the sandbox/test matrix is signed off.

## 7. Stock opening procedure

Before opening:

1. confirm every sellable SKU/component has the correct base inventory unit;
2. record opening stock by inventory location;
3. reconcile expected physical quantities to opening entries;
4. verify recipes/components for configured products;
5. verify transfer source/destination locations;
6. test one transfer from request through receipt;
7. verify low-stock and minutes-of-cover thresholds;
8. verify alert acknowledge/assignment flow;
9. record inventory owner and runner/escalation assignments.

Never overwrite ledger history to make opening stock "look right". Correct errors through attributable adjustment/count mechanisms.

## 8. Live monitoring

The event operations lead watches:

- local POS responsiveness;
- offline/backlog state by device;
- Cloud/Edge connectivity;
- sync backlog and age;
- payment pending/UNKNOWN count and value;
- provider availability/latency/error signals;
- Cloud and Event Edge HTTP `429` counts by policy/path;
- sampled `HTTP_ABUSE_RATE_REJECT` and `EDGE_HTTP_ABUSE_RATE_REJECT` warnings;
- sustained rate, burst and concurrency saturation against configured ceilings;
- sales velocity by bar/device;
- critical low-stock alerts;
- open transfers and replenishment status;
- stale command-centre data warning;
- database/disk/system health.

At least every 30 minutes capture an operational evidence snapshot during the pilot, and immediately after any incident.

## 9. Incident fallback procedures

### Cloud outage

Expected behavior: local order building/capture continues.

- do not restart devices solely to restore Cloud;
- record outage start time;
- verify local commit responsiveness;
- monitor Edge/local backlog;
- avoid unsafe operator workarounds;
- after recovery, watch backlog drain and reconcile counts.

### Edge-to-Cloud outage

- continue event-local operation;
- verify Edge remains healthy;
- record backlog size/age;
- restore WAN/Cloud path;
- confirm deterministic drain and zero duplicate business effects.

### POS isolated from Edge

- keep the device local if order capture remains safe;
- do not wipe app data/reinstall;
- preserve its local outbox;
- restore LAN reachability;
- verify all queued events converge before device retirement/reassignment.

### Edge restart/failure

- preserve Edge database volume/state;
- restart using the documented service procedure;
- verify queued device traffic resumes;
- verify Edge-to-Cloud backlog drains;
- compare inventory/order counts before and after.

### Electronic payment rail outage

- show the rail as degraded/unavailable separately from POS availability;
- do not create blind repeated customer payment attempts;
- keep existing `PENDING`/`UNKNOWN` attempts unresolved until authoritative truth is obtained;
- use only approved fallback rails/workflows;
- never use a generic unaudited manual-success override.

### Abuse-control saturation or attack

- identify which Cloud/Event Edge policy is returning `429`;
- do not disable limits globally as a first response;
- verify whether the source is legitimate recovery traffic, a misbehaving registered caller or untrusted traffic;
- preserve sampled reject logs and upstream WAF/gateway evidence;
- for a single misbehaving POS, revoke/quarantine it if needed while keeping other devices operational;
- if Cloud is under attack, verify local Event Edge ordering continues and reduce non-essential Cloud/operator refresh traffic;
- if legitimate provider callbacks are being delayed, retain payment uncertainty and use authoritative reconciliation instead of forcing failure/success;
- only tune limits through the documented bounded settings and record the operator/reason/time.

### Notification provider outage

- sales/inventory processing continues;
- retain alerts/events for later delivery/escalation;
- use agreed human communications fallback if operationally necessary.

### Database degradation

- capture query/system metrics;
- reduce non-essential operator refresh/load if needed;
- never bypass idempotency/audit constraints;
- escalate before database saturation risks durability.

## 10. Event close

Before operational close:

- all known sync backlogs are drained or explicitly documented;
- unresolved payment attempts are listed with status/value/age;
- pending/unknown refunds/reversals are listed;
- cash expected vs declared is captured by bar/device/cashier scope;
- final physical counts are completed;
- inventory variances are reviewed;
- unreceived/open transfers are listed;
- unresolved critical alerts are listed;
- sales/payment/inventory drilldowns are reviewed.

Create the immutable operational close revision. Record actor, reason, timestamp, report revision and SHA-256.

If authoritative source truth changes after close, do not edit the stored revision. Reconcile live truth, reopen through the audited workflow if an operator correction is required, then create a new revision.

## 11. Post-event reconciliation

Finance/reconciliation owner verifies:

- gross sales by currency;
- discounts/comps/voids/refunds;
- net sales;
- tender totals by method;
- electronic provider transaction truth;
- cash expected/declared/variance;
- unresolved payments and adjustments;
- inventory expected/physical/variance;
- open transfers;
- stored close revision hash/export.

Provider transaction reconciliation is not the same as acquirer/bank settlement. Obtain provider settlement/deposit evidence separately before declaring financial settlement complete.

## 12. Backup and restore exercise

Before a larger-than-pilot deployment:

- take a real database backup using the deployment procedure;
- restore it into an isolated environment;
- verify schema/migration integrity;
- verify representative orders/payments/inventory/audit/close records;
- record backup start/end, restore start/end and operator;
- retain evidence of successful restore.

A backup policy without a tested restore is not a passed reliability gate.

## 13. Evidence pack

Retain:

- release commit SHAs and CI results;
- device provisioning list;
- network topology and latency/loss samples;
- pre-open checklist;
- 100-order offline durability result;
- payment sandbox/test matrix;
- provider callback/timeout evidence;
- abuse deployment mode and effective rate/burst/concurrency settings;
- abuse/flood exercise result, HTTP `429` counts and sampled reject evidence;
- upstream distributed-protection configuration/evidence when applicable;
- inventory opening/count/transfer evidence;
- incident timeline and actions;
- command-centre snapshots;
- backlog peak/drain measurements;
- event close revisions/CSV/hash;
- database backup/restore evidence;
- post-event reconciliation sign-off.

## 14. Graduation criteria

A controlled pilot can graduate to a materially larger event only when:

- permanent CI gates are green;
- no P0/P1 security issue remains open;
- real supported-device local interaction p95 is below 150 ms;
- real local commit p95 is below 250 ms;
- the offline 100-order/restart test loses zero committed orders;
- sync replay/duplicate tests create zero duplicate business effects;
- provider timeout/late/duplicate callback matrix passes;
- the abuse-control exercise passes without starving local event operations or corrupting payment truth;
- no unexplained payment reconciliation discrepancy remains;
- inventory converges with no unexplained ledger discrepancy;
- backup restore has been proven;
- the controlled live pilot closes and reconciles successfully;
- the human go/no-go review explicitly approves the larger topology/volume.

Until that evidence exists, the correct release status is **controlled pilot candidate**, not festival-ready.
