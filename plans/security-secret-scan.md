# Security — committed secret scanning

Status: **in progress**
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
- workflow has only `contents: read` permission;
- action references are immutable and pass `scripts/check-workflow-pins.mjs`;
- Gitleaks version is explicit;
- comments and finding-artifact upload are disabled;
- any scanner finding or scanner failure fails the workflow;
- no wildcard allowlist/suppression is introduced;
- current repository history passes or any real finding is remediated before merge.

## Non-goals

- Do not claim CI secret scanning replaces GitHub secret scanning, provider-side token monitoring or secret-manager policy.
- Do not store production secrets in repository variables to make the scanner pass.
- Do not rewrite history before revoking/rotating an exposed credential.
