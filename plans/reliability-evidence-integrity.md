# Reliability — evidence integrity binding

Status: **in progress**
Base: `main` at `58dca72842aeb900334d614d4f8caa21e651f6b2`

## Objective

Make controlled-pilot PASS evidence tamper-evident and locally verifiable. A gate must no longer be able to pass with an arbitrary non-empty evidence label; every evidence reference must identify retained bytes and their SHA-256 digest, and CLI validation must fail if a referenced file is missing or has changed.

## Scope

1. Evolve the pilot evidence manifest to schema version 2.
2. Replace string `evidenceRefs` entries with `{ path, sha256 }` records.
3. Validate safe relative evidence paths and lowercase 64-character SHA-256 digests.
4. During `pilot:evidence:validate`, resolve evidence relative to the manifest directory, reject path traversal, require regular files, hash the bytes, and fail closed on any digest mismatch.
5. Keep programmatic structural validation deterministic and testable without filesystem access.
6. Update pilot preflight so claimed PASS records must use the same evidence-integrity shape.
7. Document the operator workflow for hashing retained evidence before sign-off.

## Acceptance criteria

- New manifests initialize as schema version 2.
- A PASS gate with a string evidence reference is rejected.
- A PASS gate with an invalid digest is rejected.
- CLI validation fails when referenced evidence is missing, is not a regular file, escapes the evidence root, or has a digest mismatch.
- CLI validation passes when retained evidence bytes match every declared digest and all existing pilot gates are otherwise valid.
- Preflight rejects unsupported PASS evidence records before field execution.
- Existing synthetic/representative, dependency blocker, named owner, named reviewer and exact-release fail-closed rules remain intact.
- Full TypeScript, Android and SCA CI remains green.

## Non-goals

- Do not generate, fabricate or infer field evidence.
- Do not mark any gate PASS automatically.
- Do not weaken branch-protection, representative-recovery or named-review requirements.
