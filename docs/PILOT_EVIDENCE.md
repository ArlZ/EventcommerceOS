# Pilot evidence manifest

The pilot evidence manifest converts the real-world gates in `docs/PILOT_RUNBOOK.md` into one reviewable, exact-release checklist. It does **not** run the hardware/network/provider exercises and it does not create evidence on their behalf.

## Initialize

From the exact release candidate checkout:

```bash
pnpm pilot:evidence:init
```

The default output is:

```text
artifacts/pilot-evidence/pilot-evidence-<release-sha>.json
```

Every gate starts as `NOT_RUN`. Initialization is therefore safe to automate; it can never declare the pilot ready.

To tie the manifest to an explicit candidate SHA rather than the checked-out HEAD:

```bash
PILOT_EVIDENCE_RELEASE_COMMIT=<40-char-sha> pnpm pilot:evidence:init
```

New manifests use schema version 2. Version 2 makes PASS evidence tamper-evident: evidence is referenced by both its retained path and the SHA-256 digest of the reviewed bytes.

## Populate only after real execution

Record the pilot identity, named owners and the evidence produced by the actual exercises. A gate may be changed to `PASS` only after its real exercise is complete and reviewed.

`pilot.deploymentMode` must use the same Task 010 security meaning as the runtime: `single_instance_pilot` or `upstream_distributed`. Any other value fails validation.

Required gates:

- `branchProtection`
- `dependencySecurity`
- `representativeRecovery`
- `abuseFloodExercise`
- `hardwareNetwork`
- `paymentFaultMatrix`
- `offlineDurability`
- `inventoryCloseReconciliation`
- `controlledPilotClose`

A PASS requires:

- at least one digest-bound `evidenceRefs` entry;
- a named `reviewer`;
- an RFC3339 `reviewedAt` timestamp.

Each evidence reference has this shape:

```json
{
  "path": "evidence/hardware-network/results.json",
  "sha256": "<64-character-lowercase-sha256>"
}
```

The path is relative to the directory containing the manifest. It must stay inside that directory tree. Absolute paths, `.`/`..` traversal and legacy string-only evidence references are rejected.

## Retain and hash evidence

Place or export the reviewed evidence underneath the manifest directory before recording PASS. For example:

```text
artifacts/pilot/
├── evidence.json
└── evidence/
    └── hardware-network/
        └── results.json
```

Generate the exact reference rather than typing a digest manually:

```bash
pnpm pilot:evidence:hash -- \
  artifacts/pilot/evidence.json \
  artifacts/pilot/evidence/hardware-network/results.json
```

The command prints a JSON record containing the relative path and SHA-256 digest. Copy that record into the gate's `evidenceRefs` array.

`artifacts/pilot/` and the default `artifacts/pilot-evidence/` directory are intentionally ignored by Git. Pilot evidence may contain venue, reviewer, operational or security-sensitive metadata and must not be committed to the source repository. Retain the reviewed evidence bundle in the approved evidence store and preserve its digest-bound structure for validation.

If evidence originates in CI, secure storage, an incident system or another external system, retain an export or a small review record under the manifest directory first. The manifest deliberately validates retained bytes rather than trusting a mutable URL or label.

Do not place secrets, provider credentials, customer payment data or raw database dumps inside the manifest. Evidence files themselves must follow the project's secure evidence-handling rules.

## Additional fail-closed rules

- `representativeRecovery` requires `representativeData: true`; the synthetic CI restore smoke cannot satisfy this gate;
- `dependencySecurity` requires `blockingFindings: 0`;
- every named owner from the runbook must be populated;
- the manifest release commit must match the candidate being validated;
- every PASS evidence file must exist and be a regular file;
- every retained file must still hash to the exact SHA-256 recorded at review time.

Changing or replacing reviewed evidence after sign-off therefore causes validation to fail until the new bytes are reviewed and the manifest is deliberately updated.

## Validate

```bash
pnpm pilot:evidence:validate -- artifacts/pilot/evidence.json
```

Validation exits non-zero for `NOT_RUN`, `FAIL`, missing reviewer/evidence data, release mismatch, legacy/unsafe evidence references, missing evidence files, digest mismatches, non-representative recovery or dependency blockers.

For an archived candidate that is not currently checked out, set the expected SHA explicitly:

```bash
PILOT_EVIDENCE_RELEASE_COMMIT=<40-char-sha> pnpm pilot:evidence:validate -- <manifest.json>
```

A validator PASS means the manifest is complete, every required gate is recorded as passed with named review, and every retained evidence file still matches the digest recorded in the manifest. It remains subject to the named human go/no-go review in `docs/PILOT_RUNBOOK.md` and does not make the product major-festival ready by itself.
