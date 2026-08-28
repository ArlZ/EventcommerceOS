# Controlled-pilot evidence pack initialization

Use this initializer when an exact release candidate is ready for real-world controlled-pilot exercises.

It creates an empty evidence pack without marking any gate PASS and without authorizing live money.

## Initialize

```bash
pnpm pilot:evidence:pack -- \
  <40-character-release-sha> \
  artifacts/pilot/<candidate-name> \
  "<event name>" \
  "<YYYY-MM-DD>" \
  "<venue>" \
  single_instance_pilot
```

The destination must be empty or absent. The initializer refuses to overwrite a directory that already contains evidence.

## Output

The directory contains:

- `evidence.json` — schema-v2 pilot manifest with all required gates `NOT_RUN`;
- `execution-plan.json` — ordered field stages, documentation references, verifier commands and expected reviewed reports;
- `inputs/` — reserved for non-secret field-exercise input manifests;
- `evidence/` — retained machine-verifiable reports and collected field evidence.

The execution plan starts with:

```text
disposition=NOT_RUN
liveMoneyApproved=false
```

and every governance/field stage is `NOT_RUN`.

## Recommended execution order

1. Review branch-protection and exact-release dependency/SCA evidence separately.
2. Run the physical venue hardware/network exercise.
3. Run the M-PESA Daraja sandbox fault matrix.
4. Run offline POS/Event Edge durability, verify it with `pilot:durability:verify`, then independently verify Cloud convergence and deliberate duplicate replay.
5. Run the authorised abuse/flood exercise.
6. Run the representative backup/restore drill and recovery review.
7. Reconcile inventory and perform the actual Event Close workflow. Set `PILOT_EVIDENCE_RELEASE_COMMIT` to the exact full release SHA when collecting and verifying Event Close evidence.
8. Attach only genuinely reviewed field reports with `pnpm pilot:evidence:review`.
9. Validate the complete manifest with `pnpm pilot:evidence:validate`.
10. Configure the exact Cloud, venue Event Edge and Control Web health URLs, then run `pnpm pilot:release:review` for the final machine-verifiable handoff to named human go/no-go.

The generated `execution-plan.json` also records these prerequisites beside the affected stages. Follow the referenced runbooks rather than treating the one-line command as a substitute for the field procedure.

## Important boundary

The initializer is deliberately administrative. It does not collect evidence, execute a test, infer a PASS, or write a reviewer name.

Do not fill the pack with synthetic PASS reports. A field gate can advance only after the exact-release exercise has actually been completed, the corresponding fail-closed verifier has passed, and the named reviewer has inspected the retained bytes.

M-PESA remains sandbox-only until the complete controlled-pilot release process has passed and the human go/no-go decision separately authorizes the next step.
