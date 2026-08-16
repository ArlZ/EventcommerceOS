# Reliability — fail-closed production endpoint configuration

Status: **in progress**
Base: `main` at `3db6166ba7bbd5ec473f2a16fdbc9c8183591cf7`

## Objective

Prevent production Cloud API and Control Web artifacts from silently inheriting localhost or structurally ambiguous browser/API origins.

## Scope

1. Require explicit `CONTROL_WEB_ORIGIN` when Cloud API runs with `NODE_ENV=production`.
2. Validate the production Control Web origin as one canonical HTTPS origin with no credentials, path, query or fragment.
3. Preserve the localhost fallback for non-production development/tests.
4. Require an explicit canonical HTTPS `NEXT_PUBLIC_CLOUD_API_URL` for production container builds.
5. Pass explicit synthetic HTTPS origins in the runtime-container smoke so production startup/build semantics are exercised rather than bypassed.
6. Document the non-secret endpoint configuration in `infra/.env.example`.
7. Add unit coverage for valid and invalid Cloud CORS-origin configuration.

## Acceptance criteria

- production Cloud startup fails before listening if `CONTROL_WEB_ORIGIN` is absent;
- production Cloud rejects plaintext HTTP, credentials, path/query/fragment and malformed origins;
- a canonical HTTPS origin, including an explicit non-default port, is accepted;
- non-production retains `http://localhost:3000` when no origin is configured;
- Docker production builds fail when `NEXT_PUBLIC_CLOUD_API_URL` is absent, plaintext, contains a path/query/fragment/credentials or is not canonical;
- runtime-container CI supplies explicit HTTPS Cloud/Web origins and remains green;
- existing security headers, Trivy image SCA, exact release identity, migrations, readiness and non-root checks remain intact;
- permanent CI remains green.

## Non-goals

- Do not choose the real production hostnames in source control.
- Do not add HSTS before the public TLS/ingress boundary is selected and reviewed.
- Do not widen CORS to multiple origins or wildcards.
- Do not change operator authentication/session architecture.
