# Execution Plan 007 — Card Terminal Adapter + Payment Fallbacks

## Goal

Add a real Kenya-relevant card-terminal/acquirer boundary using the current documented Pesapal Sabi wireless POS contract, plus a controlled external/manual terminal fallback. Preserve the shared payment state machine, immutable attempt history, idempotency, reconciliation, and offline-first ordering semantics from Task 006.

The public Sabi wireless contract is terminal-originated: a Pesapal terminal sends a completed transaction notification to our HTTPS endpoint and Pesapal provides a separate verification endpoint that is the final source of truth. Pesapal's POS-driven wired API is access-restricted. This task must not invent the restricted request/response contract; POS-driven terminal commands remain a deployment integration gate until Pesapal grants access and the official restricted documentation is available.

## Non-negotiable invariants

1. Raw PAN, CVV/CVC, PIN, track/magstripe data, EMV blobs, cryptograms and cardholder authentication secrets never enter Event Commerce OS request models, logs or persistence through our payment interfaces.
2. Pesapal-specific payloads remain inside the provider adapter and webhook boundary.
3. Provider secrets are runtime-only and never shipped to POS/Event Edge.
4. A Sabi notification is not settlement truth by itself. The confirmation code must be independently verified with Pesapal before a payment can become `SUCCEEDED`.
5. Notification headers are authenticated using configured credentials before processing.
6. Amount, currency and merchant reference are correlated against the immutable payment attempt. Mismatch becomes reconciliation/manual review, never last-write-wins.
7. Duplicate notification/retry has one business effect.
8. Provider timeout or ambiguous verification is `UNKNOWN`, not failure.
9. Manual terminal evidence is append-only, reference-bearing, permission-gated and audited.
10. Manual approval must never overwrite an integrated attempt. `UNKNOWN` integrated truth must be reconciled first. A reference-less Sabi attempt may be manually marked `DECLINED` only by an authorized supervisor when the physical terminal visibly declined and no provider confirmation code was issued; a later verified success must surface as a conflict.
11. Electronic rail availability is reported independently from POS/local ordering availability.
12. No PCI-compliance claim is made for Event Commerce OS. The provider/deployment PCI boundary is documented explicitly.

## Vertical slices

### 1. Provider-neutral webhook context and safe model boundary

Extend the provider adapter boundary so authenticated providers can receive normalized request-header context without leaking provider headers into the payment domain. Add a prohibited-card-field guard for external payment payloads and tests proving serialized shared/application payment models contain no raw card credential fields.

### 2. Pesapal Sabi wireless adapter

Add a `pesapal_sabi` provider that:

- creates an awaiting-terminal payment attempt using the existing idempotent payment pipeline and merchant reference equal to the immutable payment-attempt identifier;
- accepts Pesapal Sabi wireless transaction notifications;
- verifies notification authentication headers with runtime configuration;
- validates the documented notification schema;
- independently calls Pesapal's documented transaction-verification endpoint using the confirmation code;
- maps documented verified completion to `SUCCEEDED` and any unproven/ambiguous result to `UNKNOWN` rather than guessing undocumented decline codes;
- retains the Pesapal confirmation code as the provider reference for reconciliation/history;
- never accepts card credential fields.

### 3. Callback correlation for deferred provider references

Allow a verified callback to correlate by immutable payment-attempt merchant reference when the provider reference is only assigned after the terminal transaction. Once correlated, store the verified confirmation code as provider reference and enforce the same amount/currency/terminal-state conflict rules as Task 006.

### 4. External/manual terminal fallback

Add a provider-neutral manual terminal confirmation record with:

- immutable confirmation id and idempotency key;
- event/order/payment-attempt identity;
- amount/currency;
- external terminal/provider reference;
- requesting/confirming actor identity;
- reason;
- explicit approval outcome;
- append-only audit event;
- a dedicated `PAYMENT_MANUAL_CONFIRM` permission.

A manual `APPROVED` outcome is valid only for a dedicated `external_terminal` attempt. The service rejects blank/reused references for different attempts, amount/currency mismatches, unauthorized actors, and any attempt already in `UNKNOWN`/terminal truth.

Because Pesapal's public wireless documentation describes completed-payment notifications but does not publish the restricted wired decline contract, an authorized supervisor may record `DECLINED` evidence against a still-reference-less `pesapal_sabi` attempt when the physical terminal visibly declines. That evidence does not become the Pesapal provider reference. If a delayed verified success later arrives, it must produce explicit `CONFLICTING_PROVIDER_TRUTH` manual review.

### 5. Event Edge and Android POS flow

Make the existing POS -> Edge payment transport provider-neutral instead of requiring an M-PESA phone for every payment. Add a card-terminal choice that creates a `pesapal_sabi` attempt and shows the merchant reference/operator guidance without any card-entry UI. Keep local order durability independent of rail availability. Surface terminal/manual pending/unknown truth using the existing payment status model. Proxy controlled manual-terminal confirmation and rail-health operations through Event Edge.

### 6. Payment rail health

Expose provider availability/health independently from general POS availability. Sabi callback/verification errors and unresolved attempts must be visible as payment-rail issues while the local POS remains usable.

### 7. Documentation and deployment boundary

Update `docs/PAYMENTS.md` with the Sabi wireless flow, manual fallback rules, prohibited-data boundary, runtime configuration, and the explicit restricted-wired-API gate. Do not claim PCI compliance.

## Failure-mode tests

Automate at minimum:

1. duplicate card-terminal initiation -> one payment attempt/business effect;
2. duplicate Sabi notification -> one state transition;
3. terminal transaction completes after POS/app disconnect -> verified callback resolves the existing attempt;
4. verification timeout -> `UNKNOWN`, later authoritative verification may resolve success;
5. mismatched amount/currency/reference -> no success, explicit reconciliation conflict;
6. forged/wrong Sabi notification credentials rejected;
7. missing/malformed confirmation code rejected;
8. provider status/verification path retains confirmation code for reconciliation;
9. manual fallback permission denied for unauthorized actor;
10. manual fallback idempotent replay has one business effect and an immutable audit trail;
11. manual approval cannot replace an integrated card attempt;
12. supervised Sabi decline evidence followed by delayed verified success -> explicit conflict/manual review;
13. terminal/provider outage does not block local order building;
14. prohibited card-field names/data do not appear in serialized application payment models or durable POS fixtures;
15. Android card flow survives restart and preserves unresolved state.

## Provider/deployment constraints

- Selected real provider surface for this slice: Pesapal Sabi wireless POS notification + verification API, based only on current public official documentation.
- Pesapal's wired Sabi integration is explicitly access-restricted. No wired command, SDK method, decline code or local-terminal protocol will be guessed.
- A later deployment step may replace/extend the Sabi wireless adapter with the official wired adapter after Pesapal grants documentation/API access; that change must stay behind the same `PaymentProvider` boundary.
- Real merchant credentials, API keys, terminal provisioning and IP allow-listing are deployment concerns and are not committed to source control.

## Completion criteria

Task 007 is complete for the documented public Sabi surface when terminal-originated card success is authenticated and independently verified, deferred references correlate safely, manual external-terminal confirmation is permissioned/audited/idempotent, supervised Sabi decline evidence is narrowly controlled, Android/Edge flows are provider-neutral, prohibited card data cannot enter our application contracts/persistence, rail health is distinct from POS health, docs state the PCI/deployment boundary, and the permanent repository gates plus card-terminal failure suite are green.

Full POS-driven wired Sabi initiation is not considered implemented until Pesapal grants the restricted API documentation; the repository must continue to state that limitation rather than fabricate support.