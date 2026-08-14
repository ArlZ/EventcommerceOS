# Security & Reliability Baseline v0.3

## Security baseline

- TLS for network transport. Event Edge → Cloud transports refuse cleartext HTTP outside loopback development.
- Encrypted sensitive local storage where platform support allows.
- Device registration, scoped credentials and revocation.
- Role-based access control with authenticated actor provenance.
- Step-up/supervisor approval remains required for configured high-risk actions.
- Provider secrets stay in managed runtime secret storage, never client apps or source control.
- Provider callback routes use provider-specific verification/reconciliation rather than operator/device credentials.
- Structured append-only audit trail for privileged actions.
- In-process pilot rate limiting is present; production still requires reverse-proxy/API-gateway request-size/rate/abuse controls.
- Database backup and tested restore procedures remain a deployment requirement.
- Least collection/retention of customer personal data.
- Raw card credentials are not accepted by Event Commerce OS payment command models or persisted/logged. PAN/card number, CVV/CVC, PIN, track/magstripe data, EMV payloads and cryptograms remain inside the certified payment terminal/provider boundary.
- Payment command endpoints use strict field allowlists so arbitrary terminal/card payload data is rejected rather than silently carried through the application.
- Manual terminal confirmation requires explicit `PAYMENT_MANUAL_CONFIRM` permission plus authenticated actor identity, amount/currency match, external provider/reference, outcome and reason. Every successful manual confirmation creates immutable evidence and an append-only audit event.
- Manual approval cannot overwrite an integrated provider attempt. An integrated `UNKNOWN` payment must be reconciled rather than manually converted to success. For the documented Pesapal Sabi wireless decline gap, only a supervised reference-less `DECLINED` evidence record is permitted; a later verified success becomes an explicit conflict/manual-review case.
- Payment-rail availability is separate from POS/local-order availability. A degraded/unconfigured electronic rail must not disable product entry or other local ordering operations.
- This architecture reduces card-data exposure but does not itself establish PCI DSS compliance or a particular PCI scope. Compliance obligations must be assessed for the selected acquirer, terminal, merchant configuration, network and deployment architecture.

## Identity and device trust — Task 011

### Credential format and storage

Event Commerce OS uses high-entropy opaque credentials of the form:

```text
<credential-uuid>.<random-secret>
```

The raw token is returned only when the credential is first created or rotated. Server persistence contains only:

- credential ID;
- SHA-256 secret hash;
- principal scope/claims;
- label;
- expiry;
- revocation/rotation metadata;
- audit references.

Secret verification uses timing-safe comparison. Raw bearer/device/Edge secrets must never be placed in audit payloads or application logs.

### Operator credentials

Cloud operational/admin authority comes from `Authorization: Bearer <token>`.

The Cloud secure-default guard derives:

- actor ID;
- organisation scope;
- role (`ADMIN` / `PLATFORM_ADMIN`);

from the authenticated credential. Legacy `x-actor-id` / `x-role` headers have no authority: the guard overwrites them before controller/domain code receives the request. Organisation admins cannot mint/manage `PLATFORM_ADMIN` authority. The final recoverable operator credential cannot be revoked; it must be rotated instead.

The first operator is created only through the bootstrap endpoint and only when `SECURITY_BOOTSTRAP_SECRET` is explicitly configured. Bootstrap:

- has no default secret;
- timing-safely verifies the configured secret;
- is serialized with a database advisory lock;
- permanently refuses another bootstrap once any operator credential exists.

After initial bootstrap, remove/disable the bootstrap secret in the deployment.

### POS device credentials

Each POS credential is scoped to:

- organisation;
- event;
- sales location;
- immutable device ID;
- expiry/revocation state.

The Event Edge verifies the device credential locally using the installed event security snapshot before accepting POS sync/payment traffic. Device sync additionally verifies:

- batch `deviceId` equals the authenticated device;
- each envelope `deviceId` equals the authenticated device;
- business `eventId` equals the credential event;
- `salesLocationId`, when present, equals the credential sales location.

Android keeps the raw device token outside Room/order/payment/outbox data. `DeviceCredentialStore` encrypts it with an Android Keystore AES-GCM key and stores only IV + ciphertext in private app preferences. Sync/payment transports read the token only at request time and send:

```text
Authorization: Device <token>
```

There is intentionally no shared device credential across POS units.

### Event Edge service credential

Each Event Edge Cloud credential is scoped to:

- organisation;
- event;
- Edge ID;
- expiry/revocation state.

Event Edge runtime receives the one-time raw credential through deployment secret management as `EDGE_CLOUD_CREDENTIAL`; it is not stored in the event security snapshot. Edge → Cloud sales sync, inventory sync and payment orchestration send:

```text
Authorization: Edge <token>
```

Cloud rejects a valid Edge credential if the batch claims another `edgeId`, another event, or a payment attempt outside the credential event.

### Event Edge security snapshot

Cloud exports a signed, monotonically versioned event security snapshot containing **hashes and claims only** for currently active operator/device credentials. No raw operator/device/Edge secret appears in the snapshot.

The current pilot implementation signs canonical JSON with HMAC-SHA256 using `EDGE_SECURITY_SNAPSHOT_SECRET`. Event Edge:

- independently verifies the signature;
- rejects malformed/expired credential entries;
- rejects wrong organisation/event scope;
- rejects repeated credential IDs;
- rejects replay/rollback to an installed or older version;
- atomically replaces the local operator/device registry inside one database transaction.

The Edge database enforces **one active event security context per Event Edge instance**. This matches the Event Edge architecture and its single event-scoped Cloud service identity.

Because the current snapshot signature is symmetric HMAC, the signing secret is security-sensitive on both Cloud and Edge. A compromised Edge host must be rebuilt/rotated and the signing secret changed. A later production hardening phase may move to asymmetric signing so Event Edge holds verification material only.

### Offline authorization

Cloud is not involved in the synchronous POS authentication path.

During a Cloud/WAN outage, Event Edge can continue to authenticate:

- registered POS devices;
- event operators;

using the last valid locally installed snapshot. Existing event-level permission tables remain the domain authorization decision for inventory/manual-payment actions, but the `actorId` supplied to those checks is now derived from the authenticated operator. Event Edge overwrites any body-supplied `actorId` before validation/service execution and constrains event-scoped reads/mutations to the snapshot event.

Revocation therefore has two different propagation paths:

- Edge service credential revocation is enforced by Cloud immediately on the next Edge → Cloud request;
- operator/device revocation reaches an offline Edge when a newer signed snapshot is installed, or when the credential naturally expires.

Operational policy must refresh the Edge snapshot immediately after revoking a device/operator during an event whenever connectivity permits.

### Provider callbacks

Provider callback endpoints are explicitly classified `PROVIDER_CALLBACK` and are not protected by operator/device/Edge bearer credentials. They continue through provider-specific controls:

- M-PESA callback schema/correlation/reconciliation;
- Pesapal Sabi notification credential checking plus independent transaction verification;
- duplicate callback/event suppression;
- amount/currency/reference consistency rules.

This prevents operator authentication from breaking provider delivery while preserving the rule that provider callback input is untrusted until verified/reconciled.

### Secure-default route classification

Cloud routes default to `OPERATOR` unless explicitly classified as:

- `PUBLIC_HEALTH`;
- `PROVIDER_CALLBACK`;
- `BOOTSTRAP`;
- `EDGE_SERVICE`;
- `OPERATOR_OR_EDGE`.

Event Edge routes default to `OPERATOR` unless explicitly classified as:

- `PUBLIC_HEALTH`;
- `SNAPSHOT_INSTALL`;
- `DEVICE`.

A new operational route therefore does not become public merely because a developer forgets an authentication decorator.

### Abuse controls

Cloud and Event Edge include bounded per-process fixed-window pilot rate limits and return HTTP `429` without invoking domain mutation after the limit is exceeded. Tests verify the limit has no credential/security-domain side effect.

These controls are defense in depth only. Production still requires gateway/reverse-proxy controls for:

- distributed rate limiting;
- request body size limits;
- connection limits/timeouts;
- provider-callback retry-aware limits;
- WAF/abuse monitoring where appropriate.

Rate limiting must never create a Cloud dependency for local POS checkout.

### Browser operator access

Control Web uses a memory-only operator credential shell. The token:

- is password-masked in the UI;
- is not written to localStorage/sessionStorage;
- is injected only into requests to the configured Cloud API origin;
- is cleared on page reload or explicit Clear.

This is a controlled-pilot credential UX, not enterprise SSO. Federation/OIDC, refresh-token/session management and central workforce identity remain future work.

### Controlled test compatibility

Legacy test suites may bypass the new global guards only when **both** are true:

```text
NODE_ENV=test
SECURITY_TEST_BYPASS=true
```

No development or production fallback exists. Task 011 security acceptance suites explicitly turn this bypass off.

## Remaining identity/security limitations before production scale

Task 011 closes the code-level pilot trust gaps found by Task 010, but deployment validation remains mandatory:

- provision/rotate secrets through a real secret manager and controlled device setup process;
- there is not yet a cashier-facing/MDM-grade POS credential provisioning/rotation UI; pilot setup must use the controlled provisioning workflow and `DeviceCredentialStore.provisionToken`;
- HMAC snapshot signing is symmetric as described above;
- operator tokens are opaque bearer credentials rather than federated workforce sessions;
- in-process rate limits are not distributed;
- device MDM/remote wipe is not implemented;
- step-up/supervisor UX/policy is only available where the domain permission/action already requires it; there is no general step-up authentication framework;
- backup/restore, secret rotation, WAN failover and incident procedures must be rehearsed in the target deployment;
- permanent CI and real hardware/provider evidence remain release gates.

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
- Authentication: Cloud/WAN unavailability must not prevent Event Edge from authenticating a currently valid POS/operator credential already present in the signed local security snapshot.

Electronic payment completion time depends on the external rail; the UI must remain responsive while truth is pending. Payment-rail health must be presented independently from general POS availability.

## Chaos/security scenarios before live pilot

- disconnect Cloud WAN while valid device/operator credentials continue locally;
- revoke a POS credential in Cloud, install the next snapshot and prove the old device token is rejected;
- attempt device sync with a valid credential but another device/event/location claim;
- attempt Edge → Cloud sync with another Edge ID/event;
- tamper with the signed Edge snapshot;
- replay/install an older snapshot after a newer one;
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
- reconnect after a large offline backlog;
- exceed pilot API rate limits and verify no domain mutation occurs.

## Load test model

Task 010 provides a deterministic simulator for many POS devices/bar locations and fault windows. Its latency is model evidence only. Pre-production still must load-test the deployed components materially above the target event's expected peak throughput and validate the SLOs above on the supported Android/Edge/network hardware.
