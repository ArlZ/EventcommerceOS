# Reliability — Pilot evidence pack validator

Status: implementation in progress
Base: Task 010 production hardening

## Objective

Make the remaining real-world pilot gates machine-checkable without pretending CI can execute them. Operators should be able to initialize an evidence manifest tied to an exact release commit, attach real evidence as each gate is performed, and run a fail-closed validator before any live-money go/no-go review.

## Safety rules

- A newly initialized manifest marks every gate `NOT_RUN`; it never generates a PASS.
- Validation is tied to an explicit 40-character release commit and defaults to the checked-out HEAD.
- Every required gate must be `PASS`; `FAIL` and `NOT_RUN` both block validation.
- Every PASS requires evidence references, a named reviewer and an RFC3339 review timestamp.
- Representative recovery cannot pass unless the manifest explicitly records `representativeData: true`.
- Dependency security cannot pass with a non-zero blocking-finding count.
- The tool stores references/metadata only. It must not ingest secrets, provider credentials, customer payment data or database dumps.
- The validator supplements `docs/PILOT_RUNBOOK.md`; it does not replace the actual exercises or human go/no-go review.

## Required gates

1. branch protection / repository merge enforcement;
2. exact-release dependency security;
3. representative backup/restore and RPO/RTO review;
4. deployment abuse/flood exercise;
5. supported-device and event-network validation;
6. payment provider fault/reconciliation matrix;
7. offline/restart durability and replay convergence;
8. inventory/opening/transfer/count/close reconciliation;
9. controlled live pilot close and incident review.

## Implementation

- `scripts/pilot-evidence.mjs` — `init` and `validate` commands plus reusable validation functions.
- `scripts/pilot-evidence.test.mjs` — built-in Node tests for fail-closed behavior.
- `docs/PILOT_EVIDENCE.md` — operator workflow and field semantics.
- `artifacts/pilot-evidence/` — ignored local evidence-manifest working directory.
- root scripts expose `pilot:evidence:init` and `pilot:evidence:validate`; permanent `pnpm test` includes validator tests.

## Acceptance

- initial manifest validates as blocked, not passed;
- a complete valid fixture passes;
- release SHA mismatch fails;
- PASS without reviewer/evidence timestamp/reference fails;
- non-representative recovery fails;
- dependency-security blockers fail;
- existing TypeScript/Android/SCA CI remains green.
