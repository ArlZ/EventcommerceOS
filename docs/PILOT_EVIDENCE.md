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

## Populate only after real execution

Record the pilot identity, named owners and the evidence references produced by the actual exercises. A gate may be changed to `PASS` only after its real exercise is complete and reviewed.

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

- at least one non-empty `evidenceRefs` entry;
- a named `reviewer`;
- an RFC3339 `reviewedAt` timestamp.

Additional fail-closed rules:

- `representativeRecovery` requires `representativeData: true`; the synthetic CI restore smoke cannot satisfy this gate;
- `dependencySecurity` requires `blockingFindings: 0`;
- every named owner from the runbook must be populated;
- the manifest release commit must match the candidate being validated.

Evidence references may point to retained CI artifacts, approved secure evidence storage, incident records, screenshots, exports or signed review records. Do not place secrets, provider credentials, customer payment data or database dumps inside the manifest.

## Validate

```bash
pnpm pilot:evidence:validate -- artifacts/pilot-evidence/pilot-evidence-<release-sha>.json
```

Validation exits non-zero for `NOT_RUN`, `FAIL`, missing reviewer/evidence data, release mismatch, non-representative recovery or dependency blockers.

For an archived candidate that is not currently checked out, set the expected SHA explicitly:

```bash
PILOT_EVIDENCE_RELEASE_COMMIT=<40-char-sha> pnpm pilot:evidence:validate -- <manifest.json>
```

A validator PASS means the manifest is structurally complete and all required gates are recorded as passed with review evidence. It is still subject to the named human go/no-go review in `docs/PILOT_RUNBOOK.md` and does not make the product major-festival ready.
