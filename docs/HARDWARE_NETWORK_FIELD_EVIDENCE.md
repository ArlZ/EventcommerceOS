# Hardware and network controlled-pilot field evidence

This verifier turns the physical Event Edge, venue LAN and Android POS checkpoints in `docs/PILOT_RUNBOOK.md` into one machine-readable field report.

It does **not** perform the venue exercise for the operator, and it cannot approve live money. It only verifies that the retained field summary contains the minimum evidence expected for the `hardwareNetwork` gate before named review.

## What must be exercised first

Use the exact controlled-pilot release at the intended venue.

Before creating a PASS input:

- install the exact Event Edge bundle on the intended host;
- confirm PostgreSQL health, free disk, clock sync, durable storage and the configured backup/export path;
- restart the Event Edge host/service and prove state survives;
- confirm a static/reserved LAN address and the actual UPS/power-backup arrangement;
- test POS-to-Edge reachability from every represented sales location;
- disconnect WAN while preserving the venue LAN and prove POS-to-Edge operation continues;
- confirm DHCP/addressing headroom;
- provision at least two physical POS devices;
- use distinct, revocable device credentials and record only a SHA-256 identifier/fingerprint, never the credential itself;
- prove each device can cold-start without WAN, retain local state through restart, commit a local order and reconnect/sync.

The signed APK/device-provenance workflow in `docs/ANDROID_DEVICE_PROVISIONING.md` remains separate evidence and should be retained alongside this field report.

## Input

Prepare a non-secret JSON input. The required shape is:

```json
{
  "schemaVersion": 1,
  "releaseCommit": "<40-character-git-sha>",
  "eventId": "<controlled-event-id>",
  "venue": "<venue>",
  "operator": "<person who ran the exercise>",
  "liveMoneyApproved": false,
  "edge": {
    "hostId": "<physical-host-or-asset-id>",
    "releaseCommit": "<same-release-sha>",
    "postgresHealthy": true,
    "diskFreeGb": 120,
    "minimumDiskFreeGb": 20,
    "clockSynchronized": true,
    "restartTestPassed": true,
    "staticOrReservedLanAddress": true,
    "durableStorageVerified": true,
    "backupPathVerified": true,
    "upsOrPowerBackupVerified": true
  },
  "network": {
    "dhcpHeadroomConfirmed": true,
    "wanDisconnectedDuringLanTest": true,
    "posToEdgeContinuedWithoutWan": true,
    "locationSamples": [
      {
        "salesLocationId": "<sales-location-id>",
        "posToEdgeReachable": true,
        "latencyP95Ms": 18,
        "packetLossPercent": 0
      }
    ]
  },
  "devices": [
    {
      "assetId": "<physical-asset-id>",
      "registerId": "<register-id>",
      "credentialIdHash": "<sha256-of-non-secret-credential-identifier>",
      "credentialRevocable": true,
      "releaseCommit": "<same-release-sha>",
      "batteryChecked": true,
      "timezoneCorrect": true,
      "eventMenuCached": true,
      "coldStartWithoutWan": true,
      "localOrderCommitted": true,
      "localStateSurvivedRestart": true,
      "reconnectSyncPassed": true
    }
  ]
}
```

At least two device entries are required. `assetId`, `registerId` and `credentialIdHash` must be present and unique across the retained device set.

Do not put a device secret, bearer token, password, signing credential, customer data or payment credential in this input. `credentialIdHash` is only a non-secret identifier fingerprint used to prove the two registers were not sharing the same device credential identity.

## Verify

Run:

```bash
pnpm pilot:hardware-network:verify -- \
  artifacts/pilot/hardware-network-input.json \
  artifacts/pilot/hardware-network-field-evidence.json
```

The command exits non-zero unless every required check passes.

The output records:

- exact release/event/venue identity;
- Edge host disposition;
- venue LAN/WAN-isolation disposition;
- physical POS device disposition;
- device and sales-location sample counts;
- worst retained p95 LAN latency and packet-loss sample;
- overall PASS/FAIL;
- SHA-256 digest of the canonical report;
- `liveMoneyApproved: false`.

## What PASS means

A verifier PASS means the supplied field summary satisfies the fail-closed hardware/network structure and all required boolean checks are affirmative.

It still requires:

- retention of the underlying device-installation and field diagnostic evidence;
- digest-binding into the pilot evidence manifest;
- named reviewer and RFC3339 review time;
- separate offline durability, payment fault, abuse/flood, representative recovery, inventory/reconciliation and controlled-pilot-close gates.

Do not infer a venue capacity claim from this report. The latency/loss values are retained observations rather than a substitute for load/capacity validation.
