# Security remediation — dependency/SCA evidence

Status: in progress
Base: `reliability/backup-restore-evidence` (PR #19)

## Objective

Make Task 010 SEC-008 executable against the exact release candidate instead of relying on an informal dependency review.

## Scope

- Resolve the installed pnpm workspace dependency graph after a frozen-lockfile install.
- Resolve Android/Gradle dependencies from the actual build configurations.
- Query OSV.dev directly for npm and Maven package/version vulnerability records.
- Treat scanner/network failure as release-gate failure rather than a clean scan.
- Treat HIGH, CRITICAL and severity-UNKNOWN findings as blockers unless an explicit time-bounded acceptance matches the exact vulnerability/package/version.
- Generate a machine-readable evidence manifest for the exact release commit without storing credentials or business data.
- Run the scan in permanent CI and retain the evidence artifact even when the scan fails.
- Document reviewer/sign-off expectations and the distinction between code-level scanner readiness and executed release evidence.

## Security invariants

- No wildcard vulnerability ignore mechanism.
- Risk acceptance is exact on vulnerability ID, ecosystem, package and version.
- Every acceptance records `acceptedAt`, `expiresAt`, `approvedBy` and a substantive reason.
- Acceptances may last at most 90 days and expired acceptances fail validation.
- A dependency version change does not inherit an acceptance for the previous version.
- OSV/API failure cannot produce PASS.
- Severity that cannot be established is `UNKNOWN` and blocks release unless explicitly accepted.
- Evidence records package names/versions and advisory metadata only; it must not contain registry credentials, bearer tokens, database URLs or application data.
- Release evidence identifies the exact git commit and whether the working tree was clean.

## Non-goals

- Automatic dependency upgrades or vulnerability remediation.
- A claim that OSV contains every possible vulnerability.
- Static application security testing, DAST or container/OS image scanning.
- Closing SEC-006 without an executed restore drill.
- Closing SEC-007 while GitHub Actions cannot allocate runners.

## Acceptance criteria

- `pnpm security:sca` produces PASS/FAIL JSON evidence in `artifacts/sca/` and exits non-zero for a failed gate.
- Android dependency resolution is part of the same evidence run rather than a manual list.
- CI uploads the evidence on both success and failure.
- An invalid/expired acceptance causes the gate to fail.
- High/critical/unknown findings without exact active acceptance cause the gate to fail.
- The release security review records SEC-008 as executable but not closed until the exact release candidate has a real passing scan and named reviewer sign-off.
