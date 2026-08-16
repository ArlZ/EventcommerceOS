# Administrative database target safety

Database-mutating administration commands must never guess their production target. The Cloud and Event Edge maintenance utilities therefore use the same fail-closed target resolution as their migration runners.

## Production requirements

| Command | Database | Required variable |
| --- | --- | --- |
| `pnpm --filter @event-commerce/cloud-api operator-auth -- ...` | Cloud | `DATABASE_URL` |
| `pnpm --filter @event-commerce/cloud-api edge-credential -- ...` | Cloud | `DATABASE_URL` |
| `pnpm --filter @event-commerce/event-edge pos-device -- ...` | Event Edge | `EDGE_DATABASE_URL` |

When `NODE_ENV=production`, missing required database variables fail before any database connection or mutation is attempted.

Event Edge POS-device administration does **not** reuse generic `DATABASE_URL` in production. This prevents a shell or deployment environment that also contains the Cloud URL from accidentally applying device credential changes to the wrong database.

Outside production, the existing developer/test fallbacks remain available for local workflows.

## Operator procedure

Before running a production administration command:

1. identify the intended Cloud or Event Edge database from the approved deployment inventory;
2. set only the required database target variable for that tool through the approved secret/environment mechanism;
3. set the existing named actor/audit variables required by the command;
4. run the package command rather than invoking an arbitrary copied script;
5. retain the command's non-secret audit identifier/output in the relevant change or pilot record;
6. never retain one-time plaintext credentials/tokens in tickets, source control or release evidence.

The target guard prevents missing/ambiguous configuration. It does not replace operator authorization, change approval or database network/access controls.
