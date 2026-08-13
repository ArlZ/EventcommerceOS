# Codex Task 007 — Card Terminal Adapter + Payment Fallbacks

Read the existing payment domain and current official documentation for the selected card/acquirer terminal provider. Do not guess SDK/API capabilities.

## Objective

Add one certified terminal/acquirer integration without allowing provider specifics to leak into the core payment domain.

## Requirements

- Our system passes only the data necessary to initiate/reference a terminal transaction.
- Raw PAN/CVV/PIN/track data must never enter application memory/logs/storage through our interfaces.
- Approved/declined/unknown states map cleanly to the shared payment model.
- Terminal/provider reference retained for reconciliation.
- External/manual terminal confirmation mode exists as a controlled fallback with permission, reference capture and audit trail.
- Payment rail availability is shown independently from POS availability.

## Tests

- duplicate initiation request;
- terminal timeout with later approval;
- device/app disconnect during terminal transaction;
- provider status query/reconciliation;
- manual fallback permissions;
- no prohibited card fields appear in serialized application models/log fixtures.

Do not claim PCI compliance. Document the system boundary and what remains the responsibility of the chosen provider/deployment environment.
