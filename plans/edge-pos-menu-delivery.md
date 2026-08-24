# Edge to POS Menu Delivery

## Goal

Deliver each provisioned Android POS register the current menu for its authenticated Event Edge event and sales location without adding Cloud availability to the selling path.

## Context

Event Edge now persists immutable, checksummed, monotonically versioned POS menu snapshots and exposes `GET /pos-menu/current`. The endpoint derives event and sales-location scope from the authenticated POS device identity. Android already has a durable Room menu cache and checksum validation, but previously seeded the built-in development menu when no local menu existed.

That development fallback is unacceptable for a provisioned live register: if Event Edge is unavailable on first start, the POS must not silently sell test products or prices.

## Implementation

1. Derive the menu endpoint from the already-provisioned HTTPS Event Edge sync origin. Do not accept a separate menu host or caller-supplied event/location scope.
2. Fetch with the existing POS device bearer credential and device ID.
3. Parse the snapshot into the existing `MenuCandidate` domain shape. `MenuIntegrity` remains the local checksum/content boundary before persistence.
4. Install menu versions atomically in Room. Within one provisioning generation, preserve strict monotonic versioning and reject same-version content drift.
5. Bind offline cache eligibility to a SHA-256 fingerprint of the Event Edge menu origin, device ID and high-entropy device credential. Persist only the fingerprint; the credential remains in the Android keystore.
6. If provisioning changes, do not expose the previous cache offline. After a successful authenticated fetch under the new provisioning generation, allow the local menu-version namespace to restart only when there is no open order.
7. A provisioned register with no verified menu for the current provisioning generation renders `Menu unavailable` instead of the POS selling surface.
8. Retry Event Edge menu fetches in the background. Keep the last verified menu usable during temporary Event Edge loss. Periodically check for newer snapshots.
9. Do not interrupt an open order when a newer menu arrives. The order remains pinned to its original menu version; refresh the selling surface after no order is open.
10. Block device reprovisioning while an order is open so changing device scope cannot strand an in-progress transaction.

## Safety invariants

- POS ordering remains local-first; Cloud is never contacted by this path.
- Event Edge determines menu scope from authenticated device identity.
- No caller-controlled event or sales-location selector is added to Android.
- Invalid checksums, duplicate item/SKU identifiers, rollback versions and same-version drift fail closed.
- A cache from an old provisioning generation is never accepted as the offline menu for a new generation.
- Menu replacement across provisioning generations requires a successful authenticated Edge fetch and no open order.
- Existing order, payment, inventory and outbox durability semantics are unchanged.

## Failure modes to automate

- insecure or unexpected Event Edge provisioning URL is rejected;
- device credential generation changes the cache binding;
- first real menu version `1` safely replaces the exact built-in development menu version `1`;
- prior-generation cache is unavailable after reprovisioning while offline;
- authenticated reprovisioning can safely restart a lower menu version namespace;
- menu/provisioning replacement is rejected while an order is open;
- temporary Event Edge failure leaves a matching previously verified cache usable;
- invalid menu content/checksum leaves the last valid menu active.

## Verification

Required before merge:

- Android unit tests and lint;
- repository CI and dependency scan;
- secret scan;
- pilot APK build;
- exact-head review of changed files and workflow results.

## Open risk / follow-on

This change delivers configuration by polling Event Edge. A later optimization may add push/change notification, but it must remain advisory: the POS must continue to read and validate durable local menu state and must never make checkout wait for Cloud or Event Edge.
