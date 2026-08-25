# Event Edge field diagnostics evidence

The venue bundle includes a read-only Event Edge diagnostics helper for controlled-pilot evidence. It runs inside the Event Edge container, uses the already-configured local PostgreSQL connection, and emits aggregate operational state only.

Run it from `infra/edge-pilot`:

```sh
docker compose --env-file .env -f compose.yml exec -T event-edge node /app/field-diagnostics.mjs > edge-diagnostics.json
```

Do not redirect the output into the repository. Store it in the controlled pilot evidence location using a timestamped filename.

## Included evidence

The report is bound to the runtime `RELEASE_COMMIT`, `EDGE_ID` and `PILOT_EVENT_ID` and contains:

- each known device ID;
- accepted-through and highest-seen device sequence watermarks;
- processed device-event count per device;
- undelivered Edge-to-Cloud backlog count per device;
- maximum delivery-attempt count among pending Cloud events;
- unresolved reconciliation-exception counts attributable to the pilot event;
- a separate host-global count for unresolved reconciliation exceptions that have neither device nor event-instance attribution and therefore cannot honestly be assigned to one event;
- last device-seen and last Cloud-delivery timestamps;
- event inventory stock projection by inventory-location/SKU IDs and base-unit quantity;
- open transfer and open stock-count totals;
- unresolved `PENDING`/`UNKNOWN` payment-attempt counts and value by provider/status.

The event-scoped unresolved-reconciliation total deliberately excludes the host-global unattributed count. Review the host-global count as a separate safety signal; do not silently attribute those rows to the pilot event or ignore them.

The helper does **not** output event/envelope payloads, order contents, provider references, payment IDs, customer data, local-admin/cloud-sync credentials, PostgreSQL credentials, or raw reconciliation-exception details.

## Durability/reconnect use

Capture an Edge snapshot alongside each representative POS diagnostic checkpoint:

1. baseline before WAN/Cloud isolation;
2. after offline transactions have reached Event Edge;
3. after selected POS/Edge restart exercises where applicable;
4. immediately after WAN restoration;
5. after complete convergence.

Correlate each POS device's `highestLocalSequence` and `acknowledgedThroughSequence` with the Edge device row. At final register-to-Edge convergence:

- Edge `acceptedThroughSequence` must equal the POS register's highest durable local sequence;
- processed-event counts must be consistent with the expected durable POS event count;
- no unresolved pilot-event reconciliation exception may be unexplained;
- any non-zero host-global unattributed reconciliation count must be investigated separately before relying on the Edge host as clean pilot evidence;
- Edge Cloud backlog must drain to zero before declaring Cloud convergence, unless an explicit incident/reconciliation record remains open.

At final event convergence, also confirm:

- Edge inventory projection matches the expected operational ledger result and independently observed physical/count evidence;
- no unexplained open transfer/count remains;
- unresolved payment attempts are reconciled rather than forced to success/failure.

A zero Edge backlog is not proof of provider settlement or inventory correctness by itself. Use Cloud, provider and physical reconciliation evidence as required by `docs/PILOT_RUNBOOK.md`.

## Failure behavior

Diagnostics intentionally fail closed when mandatory release/event identity is missing or malformed. They also fail if processed device events exist without a corresponding device watermark, because such a state would make a normal-looking diagnostic report misleading.

Do not edit database rows to make the diagnostic output pass. Preserve the evidence and investigate the underlying consistency problem.
