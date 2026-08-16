# Security — Control Web response header hardening

Status: **in progress**
Base: `main` at `50c555fd6f69a8d8347225dd8249d677da8812a0`

## Objective

Add safe, explicit browser response-security defaults to Control Web without imposing a brittle script/style CSP that could break Next.js application hydration or deployment behavior.

## Scope

1. Disable Next.js `x-powered-by` disclosure.
2. Apply baseline security headers to all Control Web routes through supported Next.js `headers()` configuration.
3. Prevent framing via both CSP `frame-ancestors 'none'` and legacy `X-Frame-Options: DENY`.
4. Disable MIME sniffing.
5. Suppress referrer leakage.
6. Disable browser capabilities the Control Web does not need (camera, microphone, geolocation and USB).
7. Restrict CSP object embedding and base URI without constraining script/style sources in this slice.
8. Keep transport-level HSTS out of application code because TLS termination/host ownership belongs to the deployment boundary.
9. Add deterministic configuration tests.

## Acceptance criteria

- `poweredByHeader` is false.
- all routes receive the intended baseline headers.
- CSP includes `base-uri 'self'`, `frame-ancestors 'none'` and `object-src 'none'` without adding unsafe or untested script/style restrictions.
- framing is denied independently with `X-Frame-Options: DENY`.
- `X-Content-Type-Options: nosniff` is set.
- `Referrer-Policy: no-referrer` is set.
- `Permissions-Policy` disables camera, microphone, geolocation and USB.
- `Cross-Origin-Opener-Policy: same-origin` is set.
- existing standalone output/tracing configuration remains unchanged.
- unit/config tests, production build, full CI and runtime-container checks remain green.

## Non-goals

- Do not add HSTS before the real public hostname/TLS boundary is selected and reviewed.
- Do not add `unsafe-inline` merely to claim a full CSP.
- Do not introduce nonce middleware or dynamic rendering in this slice.
- Do not change Cloud API CORS/auth/session architecture.
