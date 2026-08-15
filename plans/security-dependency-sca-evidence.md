# Security remediation — dependency/SCA evidence

Status: implementation complete; permanent execution/evidence pending
Base: `reliability/backup-restore-evidence` (PR #19)

## Objective

Make Task 010 SEC-008 executable against the exact release candidate instead of relying on an informal dependency review.

## Implemented scope

- Resolve the installed pnpm workspace dependency graph after a frozen-lockfile install.
- Exclude local workspace packages from external advisory queries while retaining their installed third-party dependency trees.
- Resolve Android transitive runtime/test/KSP dependencies from the actual Gradle configurations.
- Include pinned Android/Kotlin/KSP build-plugin coordinates in the Maven inventory.
- Query OSV.dev directly for exact npm and Maven package/version vulnerability records.
- Follow OSV batch pagination and fetch full advisory records for returned vulnerability IDs.
- Treat scanner/network/API failure as release-gate failure rather than a clean scan.
- Treat HIGH, CRITICAL and severity-UNKNOWN findings as blockers unless an explicit time-bounded acceptance matches the exact vulnerability/package/version.
- Generate a machine-readable evidence manifest for the exact checked-out git commit without storing credentials or business data.
- Require a clean git tree by default for release evidence.
- Run the scan as a separate permanent CI job after frozen pnpm install and real Gradle dependency resolution.
- Upload SCA evidence on both pass and failure.
- Document reviewer/sign-off expectations and the distinction between scanner readiness and executed release evidence.

## Security invariants

- No wildcard vulnerability ignore mechanism.
- Risk acceptance is exact on vulnerability ID, ecosystem, package and version.
- Every acceptance records `acceptedAt`, `expiresAt`, `approvedBy` and a substantive reason.
- Acceptance timestamps must be RFC3339.
- Acceptances may last at most 90 days and expired/future/invalid acceptances fail validation.
- A dependency version change does not inherit an acceptance for the previous version.
- Invalid acceptances are never entered into the matching map.
- OSV/API failure cannot produce PASS.
- Severity that cannot be established is `UNKNOWN` and blocks release unless explicitly accepted.
- Empty npm or Android/Maven inventory cannot produce PASS.
- Evidence records package names/versions and advisory metadata only; it must not contain registry credentials, bearer tokens, database URLs or application data.
- Release evidence identifies the checked-out git HEAD; an explicit release SHA must match that HEAD exactly.
- The OSV endpoint must be HTTPS and may not contain URL credentials.

## Non-goals

- Automatic dependency upgrades or vulnerability remediation.
- A claim that OSV contains every possible vulnerability.
- Static application security testing, DAST or container/OS image scanning.
- Closing SEC-006 without an executed restore drill.
- Closing SEC-007 while GitHub Actions cannot allocate runners.
- Claiming SEC-008 is closed before a real passing scan exists on the exact release candidate.

## Acceptance criteria status

- `pnpm security:sca` produces PASS/FAIL JSON evidence in `artifacts/sca/` and exits non-zero for a failed gate: **implemented**.
- Android dependency resolution is part of the same evidence run rather than a manual list: **implemented**.
- CI uploads the evidence on both success and failure: **implemented**.
- An invalid/expired acceptance causes the gate to fail: **implemented**.
- High/critical/unknown findings without exact active acceptance cause the gate to fail: **implemented**.
- Empty dependency inventory causes the gate to fail: **implemented**.
- The release security review records SEC-008 as executable but not closed until the exact release candidate has a real passing scan and named reviewer sign-off: **implemented**.
- Permanent CI actually executes the SCA job and retains exact-release PASS evidence: **pending external runner availability**.
