# Security remediation — operator authentication and payment RBAC

Status: implementation complete; permanent CI pending
Base: `security/pos-edge-trust`

## Objective

Close SEC-001 and SEC-003 without conflating machine trust with human authority and without making Event Edge inventory operations depend on WAN availability.

The trust model has three independent principals:

1. POS device credential authenticates POS -> Event Edge commerce traffic.
2. Event Edge machine credential authenticates Event Edge -> Cloud commerce/inventory traffic.
3. Operator account/session authenticates human administrative and privileged financial actions.

Provider callbacks keep provider-specific verification and are not granted operator or Edge authority.

## Operator accounts

Cloud persists `operator_accounts` with:

- UUID actor identity;
- organisation membership, except `PLATFORM_ADMIN` which is deliberately organisation-null;
- role: `OPERATOR`, `SUPERVISOR`, `ADMIN`, or `PLATFORM_ADMIN`;
- random high-entropy static credential stored only as SHA-256 digest;
- credential version and session version;
- active/revoked state and last-authenticated time.

Provision/rotate/revoke/permission changes are written to append-only `operator_account_audit`.

The static operator credential is a generated 256-bit secret, not a human-chosen password. Rotation increments credential and session versions. Revocation increments session version and disables the account.

## Signed sessions

`POST /auth/operator/session` exchanges actor ID + static credential for a signed access token.

Tokens are Ed25519 signed by Cloud and contain:

- fixed issuer `event-commerce-cloud`;
- audience `operator`;
- actor ID;
- organisation ID;
- role;
- credential version;
- session version;
- issue/expiry timestamps;
- random token ID.

Cloud keeps `OPERATOR_TOKEN_SIGNING_PRIVATE_KEY`. Event Edge receives only `OPERATOR_TOKEN_VERIFYING_PUBLIC_KEY`.

Default token lifetime is 15 minutes. `OPERATOR_ACCESS_TOKEN_TTL_SECONDS` may be configured from 60 seconds to 12 hours for bounded event-shift/offline operation.

Cloud rechecks the current operator account on every authenticated request, so account revocation, credential rotation and session revocation take effect immediately for Cloud actions even when the token has not expired.

Event Edge deliberately verifies operator tokens locally and does not introspect Cloud on each request. Event Edge authorization is therefore bounded by token expiry whether or not WAN is currently available. This is an explicit availability/security tradeoff that preserves WAN-independent local inventory control; Cloud actions remain immediately revocable because Cloud rechecks current account state on every request.

## Key lifecycle

Generate a signing keypair with:

`pnpm --filter @event-commerce/cloud-api operator-token-keypair`

The command outputs:

- `OPERATOR_TOKEN_SIGNING_PRIVATE_KEY` — Cloud secret only;
- `OPERATOR_TOKEN_VERIFYING_PUBLIC_KEY` — distribute to Event Edge.

A key rotation requires coordinated Cloud private-key replacement and Edge public-key replacement. Existing tokens signed by the retired key become invalid after the Edge public key is replaced.

Event Edge also requires `EDGE_ORGANISATION_ID`, now emitted by the Edge credential provisioning/rotation command, to reject valid tokens from another organisation locally.

## Operator lifecycle CLI

`pnpm --filter @event-commerce/cloud-api operator-credential -- <action>`

Supported actions:

- `provision` — creates a new account and one-time static credential;
- `rotate` — replaces the credential and invalidates all prior sessions;
- `revoke` — disables account and invalidates all prior sessions;
- `grant-permission` — grants an event payment permission;
- `revoke-permission` — removes an event payment permission.

Explicit event payment permissions are:

- `PAYMENT_MANUAL_CONFIRM`;
- `PAYMENT_REFUND`;
- `PAYMENT_VIEW`.

## Cloud administrative RBAC

Configuration, Command Centre and event-close controllers are protected by a global signed-operator boundary. Existing internal `AdminContext` service contracts are preserved, but `x-actor-id`, `x-role` and `x-organisation-id` are overwritten only after cryptographic authentication. Caller-supplied legacy headers have no authority.

- `ADMIN` is scoped to one organisation.
- `PLATFORM_ADMIN` may perform cross-organisation bootstrap/administration.
- `OPERATOR` and `SUPERVISOR` cannot enter the legacy administrative controllers through role-header spoofing.

Cloud inventory operational reads are also signed-operator protected and tenant/event scoped.

## Cloud payment authorization

Machine-authorized Event Edge routes:

- payment initiation;
- payment attempt reconciliation;
- rail availability;
- order payment status/history used by POS.

Each Edge is authenticated with its machine credential. Event-scoped routes verify the payment/request event belongs to the Edge's server-side organisation.

Human-authorized routes:

- manual terminal confirmation;
- refunds;
- reversals;
- sensitive payment history;
- manual confirmation history;
- event payment health.

Policy:

- `OPERATOR`: no sensitive payment authority by default;
- `SUPERVISOR`: must hold explicit event permission for manual confirmation/refund/view;
- `ADMIN`/`PLATFORM_ADMIN`: event/organisation scope still applies, explicit payment permission row is not required;
- every refund requires two distinct authenticated authorized operators;
- reversals require `ADMIN` or `PLATFORM_ADMIN`;
- body requestor/approver/actor IDs cannot override signed identities.

Event Edge forwards its machine credential for machine payment calls. Manual external-terminal confirmation forwards the human bearer token instead, so machine identity never implies supervisor authority.

## Offline Event Edge operator authorization

Event Edge inventory endpoints verify Cloud-signed operator tokens locally using the Ed25519 public key.

The signed token establishes actor, organisation and role. For normal inventory mutations, existing local `edge_inventory_actor_permissions` remain the event authorization source, including `INVENTORY_MOVE`, `TRANSFER_MANAGE`, `COUNT_MANAGE`, and `ALERT_MANAGE`. Mutation request actor IDs must match the signed token subject before those service-level permission checks run, so a valid signed token does not create blanket inventory authority.

Inventory configuration installation is the bootstrap exception because the snapshot itself installs/replaces local permissions; it therefore requires a signed `ADMIN` or `PLATFORM_ADMIN` identity and matching `sourceActorId` rather than a pre-existing `INVENTORY_CONFIGURE` row. Alert evaluation/escalation triggers require `SUPERVISOR` or higher. Notification draining requires `ADMIN` or higher. Event-scoped operational reads require a valid token for the Edge organisation and an event installed on that Edge.

## Acceptance coverage

Cloud operator tests cover:

- legacy admin headers without token -> 401;
- low-role token cannot escalate through spoofed headers;
- wrong static credential -> 401;
- valid Ed25519 signed short-lived session;
- tampered token -> 401;
- session/credential version invalidation -> existing token rejected;
- organisation scope derived from account, not request headers;
- real platform-admin cross-organisation bootstrap.

Cloud payment authorization tests cover:

- anonymous/cross-organisation Edge payment initiation rejected before business service call;
- Edge machine authorization for reconcile/order/rail calls;
- OPERATOR denied manual terminal confirmation;
- signed supervisor permission + actor binding for manual terminal confirmation;
- two distinct authorized signed operators required for refund;
- wrong-organisation/same-actor approval denied before refund service call;
- supervisor reversal denied; admin reversal accepted;
- `PAYMENT_VIEW` protects financial history/health.

Event Edge operator tests cover:

- anonymous/tampered/expired/wrong-organisation tokens rejected;
- body actor spoof rejected before ledger mutation;
- signed actor without local inventory permission denied;
- valid signed actor + local permission succeeds while WAN transport is unavailable;
- inventory configuration requires signed administrative role and matching actor.

Existing configuration, Command Centre and event-close HTTP integration tests now use real signed identities instead of trusted role headers.

## Remaining release blockers

This slice does not solve:

- endpoint rate limiting/abuse/body-size controls;
- backup/restore execution evidence;
- permanent CI, currently blocked before runner assignment;
- dependency/SCA evidence.

Overall release status remains NO-GO until those controls/evidence are cleared and permanent CI executes successfully on the exact stacked release commit.
