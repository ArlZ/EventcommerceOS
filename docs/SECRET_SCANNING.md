# Committed secret scanning

## Purpose

Source control is not an approved secret store. The `Secret scan` workflow uses Gitleaks to fail CI when committed Git history contains credentials, API keys, private keys or other secret material detectable by the scanner.

The scan complements `.gitignore`, environment-variable handling and external secret-management controls. Ignoring a file prevents a future accidental add; it does not detect a secret that was already committed.

## Workflow boundary

The scanner runs on pull requests, pushes to `main` and manual dispatch. Checkout uses the complete Git history (`fetch-depth: 0`) so a secret cannot be considered safe merely because a later commit deleted it.

The workflow is deliberately read-only:

- `contents: read`;
- `pull-requests: read`;
- checkout credentials are not persisted;
- PR comments are disabled;
- Gitleaks finding-artifact upload is disabled.

Finding artifacts are disabled because a report about a secret can create a second retention location for sensitive match data. The workflow result is the gate; incident evidence should be recorded separately without reproducing the credential value.

The action reference is pinned to the immutable commit for Gitleaks Action v3.0.0 and the scanner version is explicitly pinned to Gitleaks 8.30.1.

## Finding response

A detected credential must be treated as exposed even if the current code no longer uses it.

1. Revoke or rotate the credential at its provider first.
2. Determine the scope and period of exposure.
3. Review provider/audit logs where available.
4. Remove the secret from the current source tree.
5. Decide whether Git history must be rewritten based on the exposure and repository distribution boundary.
6. Re-run the full-history scan.

History rewrite alone is not credential remediation: anyone who already obtained the old Git object may still possess the secret.

## False positives

Do not add wildcard allowlists or disable a detector merely to obtain a green build. If a finding is demonstrably synthetic/non-secret, document the exact case and prefer the narrowest possible configuration rule. No custom allowlist is introduced by the initial gate.

## Limits

A clean Gitleaks result does not prove that runtime secret stores, CI variables, cloud credentials, payment-provider credentials or operator endpoints are configured correctly. It only states that the scanned Git history did not contain a finding under the pinned scanner/ruleset.
