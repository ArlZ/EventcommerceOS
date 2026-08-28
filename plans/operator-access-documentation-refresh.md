# Operator access documentation refresh

## Objective

Align controlled-pilot operator-access and release-security documentation with the authentication behavior already merged and deployed on `main`.

## Why this is required

The current runbook still describes the earlier browser `sessionStorage` / manually pasted opaque-token workflow and states that there is no password login. The current implementation instead uses:

- Supabase Auth password proof;
- a required six-digit email OTP;
- a short-lived HttpOnly login-challenge cookie;
- a separate HttpOnly Event Commerce OS operator-session cookie;
- server-side organisation membership/RBAC on every request.

Leaving the old procedure in a pilot runbook risks operator error and inaccurate security review evidence.

## Scope

- update `docs/OPERATOR_ACCESS.md` to document the current primary browser flow;
- preserve the audited DB-admin-issued bearer session as an emergency/provisioning/diagnostic path;
- update `docs/RELEASE_SECURITY_REVIEW.md` SEC-003 to reflect HttpOnly-cookie browser sessions and password + email-code sign-in;
- make no runtime, schema, authorization or credential changes.

## Verification

- review the documentation against:
  - `apps/control-web/src/app/sign-in/sign-in-client.tsx`;
  - `apps/cloud-api/src/auth/operator-login.controller.ts`;
  - `apps/cloud-api/src/auth/operator-login.service.ts`;
  - `apps/cloud-api/src/auth/operator-auth.service.ts`;
  - `apps/cloud-api/src/auth/operator-cookie.ts`;
  - `apps/cloud-api/scripts/manage-operator-auth.mjs`;
- run the repository's protected PR checks before merge;
- after merge, refresh the exact controlled-pilot release candidate and evidence because the protected `main` SHA changes even though runtime behavior does not.
