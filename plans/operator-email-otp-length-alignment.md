# Operator email OTP length alignment

## Context

The controlled field rehearsal exposed a real Event Control sign-in failure after SMTP delivery was restored. Password proof succeeded and Supabase issued an email OTP, but Event Control could only accept exactly six digits in both the browser UI and Cloud API.

Live diagnostic evidence showed the current Supabase Auth OTP token does not correspond to any six- or seven-digit code for the normalized operator email, which is consistent with a longer configured Email OTP length. Supabase Auth allows the project OTP length to differ from the application's previous six-digit assumption.

## Goal

Remove the hard-coded six-digit coupling while keeping the existing password + email-code security flow unchanged.

## Implementation

1. Cloud API accepts numeric Supabase email OTPs from 6 through 10 digits and still delegates truth/expiry validation to Supabase Auth.
2. Event Control uses one numeric one-time-code field rather than six fixed boxes, accepts 6-10 digits, supports browser OTP autofill, and removes misleading "6-digit" copy.
3. Operator access documentation records the provider-configured OTP-length boundary and requires the project setting/template/client to remain aligned.
4. Unit coverage proves accepted and rejected OTP lengths.

## Security / architecture

- No password, OTP, session token, SMTP credential, provider key or other secret is stored or logged.
- Supabase Auth remains the verifier of the email OTP; widening local input validation does not make an invalid provider code valid.
- Existing login challenge TTL, HttpOnly cookies, identity binding, membership/RBAC and server-side session issuance are unchanged.
- No schema or migration change.
- This is an essential authentication fix and therefore advances the previously frozen release SHA; exact-release evidence must be regenerated after merge.

## Verification

- Cloud API operator-login unit tests.
- TypeScript build/typecheck/lint/format.
- Full repository CI/release gates on the PR.
- After deployment, request a fresh OTP and complete a real password + email-code login against the exact merged release.
