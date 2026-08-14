# Security remediation — POS device to Event Edge trust

Status: implementation complete; permanent CI pending
Base: `security/edge-cloud-trust`

## Objective

Close SEC-004 by giving every POS a revocable local machine identity at Event Edge without making local ordering depend on Cloud availability.

The authenticated POS boundary covers:

- `POST /sync/device-events`;
- `POST /payments/initiate`;
- `POST /payments/attempts/:paymentAttemptId/reconcile`;
- `GET /payments/providers/availability`;
- `GET /payments/orders/:orderId`.

Manual external-terminal confirmation is intentionally not granted to the POS device credential; that remains a human/supervisor authorization concern under SEC-003/SEC-001.

## Device identity and assignment

- Android keeps its stable local `deviceId`.
- Event Edge provisions that exact ID into `edge_pos_devices`.
- Each device is assigned server-side to one installed event plus optional sales location/register metadata.
- Database foreign keys require the event and assigned sales location to exist in local Event Edge configuration.
- Order sync must match the assigned event and, when configured, the exact sales location.
- Payment initiation must match the assigned event.
- New Edge payment-cache rows retain the originating POS device; reconciliation/order-history access is then restricted to that POS. Legacy cache rows with null device attribution retain event-level fallback for upgrade safety.

## Credential lifecycle

Event Edge operator command:

`pnpm --filter @event-commerce/event-edge pos-device -- <provision|rotate|reassign|revoke>`

Required environment:

- all actions: `DATABASE_URL`, `DEVICE_ID`, `DEVICE_CREDENTIAL_ACTOR`;
- provision/reassign: `DEVICE_EVENT_ID`;
- optional provision/reassign: `DEVICE_SALES_LOCATION_ID`, `DEVICE_REGISTER_ID`.

Controls:

- provision/rotate generate a random 256-bit credential;
- Event Edge stores only SHA-256 digest;
- credential digests are unique across POS identities;
- version increments on rotation;
- revocation blocks the next authenticated Event Edge request;
- reassignment takes effect on the next request;
- append-only audit records provision/rotate/reassign/revoke;
- `last_authenticated_at` records successful requests;
- a version/status-guarded update prevents a rotation/revocation that wins during credential verification from being accepted as stale authentication.

## Android credential storage and provisioning

- First run shows the locally generated device ID.
- Operator provisions that exact ID at Event Edge and gives the device the one-time token plus HTTPS Edge sync endpoint.
- Endpoint + device ID are stored as non-secret Room metadata.
- Token is encrypted with an AES-256 key held in Android Keystore and only ciphertext/IV are stored in private SharedPreferences.
- Sync and payment transports inject the token only as `Authorization: Bearer ...` plus `X-Device-Id`; it is never written to Room/outbox payloads.
- If the Keystore key/ciphertext becomes unavailable (for example restored/copy data on another device), the credential is cleared and explicit reprovisioning is required while endpoint/device metadata remains.
- The app provides an `Update Edge credential` path so rotation does not require reinstalling or deleting local orders.
- Updating the credential restarts sync with the new token; payment transport resolves the same current secure provisioning dynamically.

## Offline-first revocation caveat

Remote revocation cannot stop a physically isolated POS from creating local-only orders/cash records while it has no Event Edge connectivity. Enforcing a remote lease would violate the platform's offline-first sale durability requirement.

Operational response for a lost/stolen device therefore is:

1. revoke the POS identity at Event Edge immediately;
2. revoke/reassign any human operator sessions separately once SEC-003 is implemented;
3. recover/quarantine the physical device if possible;
4. review any later-presented local records as reconciliation evidence rather than blindly accepting them.

Revocation does stop sync, electronic-payment initiation/reconciliation and POS-facing payment reads at the next Event Edge request.

## Security acceptance coverage

Event Edge integration tests cover:

- missing/wrong device credential -> 401 before sync persistence;
- body/event device-ID mismatch -> 401;
- wrong event assignment -> 401;
- assigned sales-location omission/mismatch -> 401;
- revoked device -> 401;
- old rotated credential -> 401, new credential -> accepted;
- reassignment enforced on the next request;
- wrong-event payment initiation -> 401 before Cloud call/cache effect;
- valid payment initiation records originating POS ownership;
- wrong-event reconciliation denied;
- another POS in the same event cannot reconcile/read owned payment history;
- existing replay/offline/concurrency sync suite runs through real authenticated device identities.

Android tests cover:

- endpoint/device ID persisted separately from the credential;
- plaintext token absent from Room metadata;
- credential loss requires reprovisioning while preserving non-secret metadata;
- insecure HTTP endpoint and weak token rejected.

## Non-goals / remaining blockers

This slice does not solve:

- human/operator authentication and server-derived RBAC;
- Cloud payment/admin API authentication;
- supervisor authorization for manual terminal confirmation/refunds/reversals;
- global request-rate/abuse controls;
- backup/restore evidence;
- dependency/SCA evidence;
- permanent CI, currently blocked before runner assignment.

Overall release status remains NO-GO for internet-exposed live-money production until the wider Task 010 blockers are closed.
