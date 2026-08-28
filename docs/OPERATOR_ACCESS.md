# Event Commerce OS — Operator Access Runbook

This is the controlled-pilot human access procedure for Cloud/Event Control. It is separate from POS device credentials, Event Edge machine credentials and payment-provider callback authentication.

## Security model

The primary browser sign-in flow is:

1. work email + password are verified against the configured Supabase Auth project;
2. Event Control sends a numeric email verification code using the configured Supabase Auth OTP length;
3. the operator enters that code;
4. only after both proofs succeed does Cloud create its own opaque operator session.

Event Control does not retain the operator password or the temporary Supabase access token. The Supabase session used to prove identity is signed out on a best-effort basis after the proof, while the Event Commerce OS operator session remains independently revocable.

Browser session controls:

- the short-lived login challenge is stored in the HttpOnly `ec_operator_login` cookie;
- the authenticated operator session is stored in the HttpOnly `ec_operator_session` cookie;
- both cookies use `SameSite=Strict`;
- cookies are `Secure` in production;
- the login challenge expires after 10 minutes;
- a normal browser session expires after 12 hours;
- **Remember this device** extends the operator session to 30 days;
- Cloud stores only the SHA-256 digest of the opaque operator session secret.

Authorization controls:

- operator identity, platform authority and organisation membership/role are resolved from Cloud database state on every request;
- `x-organisation-id` is only a requested organisation scope and never grants membership;
- caller-supplied `x-actor-id` and `x-role` are ignored/stripped;
- revoking the Cloud operator session, membership or identity takes effect independently of the upstream Supabase account.

An audited DB-admin-issued `ecom_op_...` bearer session remains available as a tightly controlled provisioning, recovery and diagnostic path. It is not the normal Event Control browser sign-in flow and must not be pasted into tickets, chat, source control or event documents.

This access model is suitable only for a bounded controlled pilot with tightly managed operators. It is not a claim of final enterprise IAM, SSO or authenticator-based MFA readiness.

## Roles

| Role | Intended authority |
| --- | --- |
| `PLATFORM_ADMIN` | Platform-wide setup, including organisation creation |
| `ADMIN` | Organisation configuration, operational actions, event close/reopen |
| `FINANCE` | Payment adjustments/history, financial close corrections and payment health |
| `SUPERVISOR` | Operational alert actions, supervised close corrections and manual-terminal confirmation where separately permitted |
| `VIEWER` | Read-only operational/financial visibility where explicitly allowed |

Manual terminal confirmation still requires the existing event-specific `PAYMENT_MANUAL_CONFIRM` permission in addition to an allowed operator role.

## 1. Provision the operator identity

Run from an environment with Cloud database administrative access:

```bash
OPERATOR_AUTH_ACTOR='<named administrator/change ticket>' \
OPERATOR_DISPLAY_NAME='<operator name>' \
OPERATOR_EMAIL='<operator work email>' \
pnpm --filter @event-commerce/cloud-api operator-auth -- create-identity
```

Record the returned `OPERATOR_ID` in the pilot access register.

For a platform administrator only, add:

```bash
OPERATOR_PLATFORM_ADMIN=true
```

Do not grant `PLATFORM_ADMIN` for normal event operations.

The same work email must exist as an approved user in the configured Supabase Auth project with a password set through the approved Auth administration process. Event Control does not create arbitrary Auth users during sign-in.

On the first successful password + email-code sign-in, Cloud binds the operator identity to the matching Supabase user when no conflicting link already exists.

## 2. Grant organisation membership

After the organisation exists:

```bash
OPERATOR_AUTH_ACTOR='<named administrator/change ticket>' \
OPERATOR_ID='<operator uuid>' \
OPERATOR_ORGANISATION_ID='<organisation uuid>' \
OPERATOR_ROLE='ADMIN|FINANCE|SUPERVISOR|VIEWER' \
pnpm --filter @event-commerce/cloud-api operator-auth -- grant-membership
```

Use the least-privileged role that satisfies the operator's event responsibility.

A `PLATFORM_ADMIN` does not need an organisation membership for platform-wide authority, but ordinary event operators do.

## 3. Sign in through Event Control

1. Open the approved Event Control origin over HTTPS.
2. Open **Sign in**.
3. Enter the provisioned work email and password.
4. After the password is accepted, check the masked email destination shown by Event Control.
5. Enter the verification code sent by email.
6. If appropriate for the managed workstation, leave **Remember this device for 30 days** enabled. Disable it on shared or temporary workstations.
7. After Event Control redirects to the home screen, select the intended organisation/event.
8. Confirm the context switcher exposes only the organisation/event the operator is authorized to use before performing any mutation.

If the verification email does not arrive, **Resend** becomes available after 60 seconds. The sign-in challenge expires after 10 minutes.

The current Event Control UI and Cloud API accept numeric email OTPs from 6 through 10 digits and Supabase Auth remains the authority for whether the supplied code is valid and unexpired. Keep the Supabase **Email OTP length**, the Magic Link/OTP template's `{{ .Token }}` output and the client validation aligned; do not hard-code template wording such as "6-digit" unless the project setting is also locked to that length.

Password recovery is administrator-managed during the controlled pilot.

## 4. End or revoke browser access

Use Event Control **Sign out** at handover or shift end where available. Cloud clears the browser cookies and revokes the server-side operator session.

If a browser session is lost, copied or otherwise suspect, revoke the corresponding Cloud operator session administratively:

```bash
OPERATOR_AUTH_ACTOR='<named administrator/change ticket>' \
OPERATOR_SESSION_ID='<session uuid>' \
pnpm --filter @event-commerce/cloud-api operator-auth -- revoke-session
```

Revocation applies on the next Cloud request.

## 5. Emergency/admin-issued bearer session

Use this only when the browser password + email-code path cannot be used and a named administrator has explicitly approved a bounded diagnostic or recovery session.

```bash
OPERATOR_AUTH_ACTOR='<named administrator/change ticket>' \
OPERATOR_ID='<operator uuid>' \
OPERATOR_SESSION_TTL_MINUTES='60' \
pnpm --filter @event-commerce/cloud-api operator-auth -- create-session
```

The command prints a one-time `OPERATOR_ACCESS_TOKEN=ecom_op_...`. Cloud stores only its digest.

Rules:

- choose the shortest practical TTL;
- transfer the token only through the approved secret channel;
- never paste it into documentation, issue threads, screenshots or chat;
- use it only as an `Authorization: Bearer ecom_op_...` credential against the Cloud API;
- revoke it immediately after the approved diagnostic/recovery task.

The current Event Control browser UI does not require or offer a token-paste workflow.

## 6. Revoke membership

When an operator should retain identity but lose access to one organisation:

```bash
OPERATOR_AUTH_ACTOR='<named administrator/change ticket>' \
OPERATOR_ID='<operator uuid>' \
OPERATOR_ORGANISATION_ID='<organisation uuid>' \
pnpm --filter @event-commerce/cloud-api operator-auth -- revoke-membership
```

## 7. Revoke the operator identity

For departure, compromise or broad access withdrawal:

```bash
OPERATOR_AUTH_ACTOR='<named administrator/change ticket>' \
OPERATOR_ID='<operator uuid>' \
pnpm --filter @event-commerce/cloud-api operator-auth -- revoke-identity
```

Identity revocation also revokes its active organisation memberships and sessions without deleting audit history.

If the corresponding Supabase Auth account must also be disabled or recovered, perform that separately through the approved Supabase Auth administration process. Event Commerce OS identity revocation remains authoritative for Event Control access.

## Pilot evidence to retain

- named operator and role;
- work email used for the operator identity, without recording passwords or OTP codes;
- organisation(s) granted;
- access grant/revocation ticket or named approving administrator;
- Cloud operator session IDs issued (never plaintext session secrets);
- shift/start/end or expiry window;
- any privilege change during the event;
- manual-terminal event permission grants;
- emergency bearer-session issuance and revocation, if any;
- sign-in or emergency revocation incidents and resolution.

## Current limitations

- no enterprise OIDC/SAML SSO integration;
- no authenticator-app/TOTP or hardware-key MFA/step-up policy;
- password recovery is administrator-managed during the controlled pilot;
- the required email code is a second email proof in the Event Control sign-in sequence, but it is not being claimed as enterprise-grade independent-factor MFA;
- public HTTP does not accept a caller-supplied second refund approver; workflows requiring two-person approval remain unavailable until the approving operator proves a separate authenticated session/step-up action.

Before graduating beyond a tightly controlled pilot, integrate the approved enterprise identity provider and MFA/step-up policy while preserving the same server-side business-role checks.
