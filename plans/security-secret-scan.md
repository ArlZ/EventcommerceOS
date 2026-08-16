# Security — committed secret scanning

Status: **implemented; awaiting exact-head CI**
Base: `main` at `211f78b1fcbd87a5c9561893221e94b782b76738`

## Objective

Add a fail-closed repository-history gate for committed credentials, API keys, private keys and other secret material without granting the scanner write access or retaining copies of detected secrets as CI artifacts.

## Scope

1. Add a dedicated Gitleaks workflow for pull requests, pushes to `main` and manual validation.
2. Pin `actions/checkout` and `gitleaks/gitleaks-action` to immutable commit SHAs.
3. Fetch full Git history so removed-but-still-committed secrets remain detectable.
4. Explicitly pin the Gitleaks scanner version rather than using `latest`.
5. Keep workflow permissions read-only.
6. Disable PR comments and scanner artifact upload to avoid unnecessary write scope and secondary retention of secret matches.
7. Introduce no allowlist until an actual false positive is reviewed.
8. Document response requirements: revoke/rotate first; history rewrite alone is insufficient.

## Acceptance criteria

- workflow runs on PRs and pushes to `main`;
- checkout uses `fetch-depth: 0` and `persist-credentials: false`;
- workflow permissions are limited to `contents: read` and `pull-requests: read`;
- action references are immutable and pass `scripts/check-workflow-pins.mjs`;
- Gitleaks version is explicitly pinned to 8.30.1;
- comments and finding-artifact upload are disabled;
- any scanner finding or scanner failure fails the workflow;
- no wildcard allowlist/suppression is introduced;
- current repository history passes or any real finding is remediated before merge.

## Implementation notes

- `gitleaks/gitleaks-action` is pinned to commit `e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e` (v3.0.0, Node 24 action runtime).
- PR comments are disabled to avoid write permission and unnecessary finding propagation.
- Gitleaks artifact upload is disabled so a finding does not create a second retained copy of sensitive match data.
- No custom `gitleaks.toml` or allowlist is introduced initially.

## Non-goals

- Do not claim CI secret scanning replaces GitHub secret scanning, provider-side token monitoring or secret-manager policy.
- Do not store production secrets in repository variables to make the scanner pass.
- Do not rewrite history before revoking/rotating an exposed credential.
