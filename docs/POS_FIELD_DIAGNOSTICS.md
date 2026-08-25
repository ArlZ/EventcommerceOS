# POS field diagnostics evidence

The Android POS exposes **Share pilot diagnostics** after a register is provisioned. The action exports a small JSON snapshot from authoritative local Room state so the controlled-pilot durability drill can be evidenced without screenshots, manual queue counting, or access to device credentials.

## Data included

The snapshot contains only operational evidence fields:

- exact app `releaseCommit` and app version;
- local device/register ID;
- active menu version;
- locally committed closed-order count;
- highest durable local outbox sequence;
- Event Edge acknowledgement watermark;
- number of local events still pending after that watermark;
- last reported Event Edge-to-Cloud backlog count;
- last successful sync timestamp;
- whether a local sync error is currently recorded;
- snapshot generation timestamp.

It deliberately does **not** export the Event Edge endpoint, device bearer token, Android Keystore material, customer data, payment credentials, order contents or raw error text.

## Offline/restart/reconnect drill

For each representative register used in Gate B, retain diagnostics at these checkpoints:

1. **Baseline** — connected, immediately before WAN/Cloud isolation.
2. **Offline committed state** — after the required offline sales have been committed and before restoring connectivity.
3. **After restart** — after force-stop/device restart while still isolated. The release commit, device ID, closed-order count and highest local sequence must remain consistent with the committed local state.
4. **Reconnect/drain** — after LAN/WAN restoration and sync convergence.

Use timestamped filenames containing the physical asset identifier and checkpoint name. The physical asset identifier should come from the controlled pilot device inventory, not from an invented identifier in the JSON.

## Pass expectations

A register is not field-ready unless the evidence shows all of the following:

- every snapshot is from the approved release commit;
- the same device ID survives restart;
- committed closed-order count never decreases across restart;
- highest local sequence never decreases across restart;
- while offline, unacknowledged local events remain present rather than disappearing;
- after reconnect, `acknowledgedThroughSequence` reaches the register's highest durable local sequence;
- after register-to-Edge drain, `pendingAfterAcknowledgement` reaches zero;
- after Edge-to-Cloud drain, `edgeBacklogCount` reaches zero or a separately explained and reconciled backlog remains;
- `hasSyncError` is false at final convergence, unless the retained incident record explains a non-commerce residual error;
- Edge/Cloud order, inventory and reconciliation evidence confirms zero duplicate business effects.

The app snapshot is evidence of the register's local state only. It cannot by itself prove Cloud convergence, inventory correctness or provider settlement; correlate it with Event Edge, Cloud and reconciliation evidence.

## Handling

The diagnostics JSON contains no authentication secret, but the device ID is operational metadata. Store and share it only through the controlled pilot evidence channels. Do not post field diagnostics publicly.

Do not wipe app data, reinstall the application, or reprovision a register merely to make a diagnostic snapshot look clean. A failed checkpoint is a failed gate until the underlying cause is understood and the drill is repeated deliberately.
