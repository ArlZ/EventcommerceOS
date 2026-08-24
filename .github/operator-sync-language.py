from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"Missing expected snippet: {label}")
    return text.replace(old, new, 1)


# Devices page: frame the task around service continuity, not infrastructure.
path = Path("apps/control-web/src/app/sync-health/page.tsx")
text = path.read_text()
text = replace_once(
    text,
    "    detail: 'Surface backlog and missing Cloud delivery before it becomes operational noise.',",
    "    detail: 'Spot registers with sales waiting to upload or no recent online reporting.',",
    "devices detect language",
)
text = replace_once(
    text,
    "  { label: 'Diagnose', detail: 'Separate local POS availability from Edge-to-Cloud delay.' },",
    "  { label: 'Diagnose', detail: 'Confirm service can continue locally before checking connectivity.' },",
    "devices diagnose language",
)
text = replace_once(
    text,
    "    detail: 'Restore connectivity without interrupting locally committed sales.',",
    "    detail: 'Restore online reporting without interrupting locally committed sales.',",
    "devices recover language",
)
text = replace_once(
    text,
    """            Use device and sync state to identify delayed or disconnected registers. POS ordering is
            local-first and must remain available while recovery happens in the background.""",
    """            See which registers are reporting normally and which need connectivity attention. A
            reporting delay alone is not a reason to stop locally committed selling.""",
    "devices page description",
)
path.write_text(text)


# Devices client: operational status in the main card, transport internals under details.
path = Path("apps/control-web/src/app/sync-health/sync-health-client.tsx")
text = path.read_text()
old_status = """function deviceStatus(device: DeviceCloudStatus): {
  label: string;
  tone: 'success' | 'warning';
  detail: string;
} {
  if (device.edgeBacklogCount > 0) {
    return {
      label: 'Backlog waiting',
      tone: 'warning',
      detail: `${device.edgeBacklogCount} Edge update(s) still need Cloud delivery.`,
    };
  }
  if (!device.lastCloudDeliveryAt) {
    return {
      label: 'Cloud delivery not observed',
      tone: 'warning',
      detail: 'This register has reached Edge, but no Cloud delivery is currently reported.',
    };
  }
  return {
    label: 'Reporting',
    tone: 'success',
    detail: 'No Edge-to-Cloud backlog is currently reported.',
  };
}
"""
new_status = """function deviceStatus(device: DeviceCloudStatus): {
  label: string;
  tone: 'success' | 'warning';
  detail: string;
} {
  if (device.edgeBacklogCount > 0) {
    return {
      label: 'Sales waiting to upload',
      tone: 'warning',
      detail: `${device.edgeBacklogCount} locally accepted update(s) are waiting to upload. Do not stop selling for this delay alone.`,
    };
  }
  if (!device.lastCloudDeliveryAt) {
    return {
      label: 'Upload not confirmed',
      tone: 'warning',
      detail: 'No online delivery has been confirmed yet. Check connectivity; this alone does not prove the register is unavailable.',
    };
  }
  return {
    label: 'Reporting normally',
    tone: 'success',
    detail: 'No pending uploads are currently reported.',
  };
}
"""
text = replace_once(text, old_status, new_status, "device status language")
text = replace_once(
    text,
    "          <strong>{organisationName || 'Cloud device telemetry'}</strong>",
    "          <strong>{organisationName || 'Register reporting'}</strong>",
    "devices context fallback",
)
text = replace_once(text, 'label="Registers observed"', 'label="Registers seen"', "devices seen KPI")
text = replace_once(text, 'label="With Edge backlog"', 'label="Waiting to upload"', "devices backlog KPI")
text = replace_once(
    text,
    'label="No Cloud delivery observed"',
    'label="Upload not confirmed"',
    "devices delivery KPI",
)
text = replace_once(
    text,
    """          <strong>Select an organisation to begin.</strong> Sync Health is operator-authenticated
          and only returns register telemetry for the selected organisation. The organisation last
          used elsewhere in Event Control is carried into this screen for the current browser tab.""",
    """          <strong>Select an organisation to begin.</strong> This screen shows whether registers are
          reporting online and whether uploads are waiting. It does not decide whether a local till
          can continue taking orders.""",
    "devices initial callout",
)
text = replace_once(
    text,
    """          <strong>No register telemetry has reached Cloud yet.</strong> This does not prove a local
          POS is unavailable; confirm Event Edge and venue connectivity before intervening at the
          bar.""",
    """          <strong>No register updates have reached the online service yet.</strong> This does not prove
          a till is unavailable; check the venue's local server and network before interrupting
          service.""",
    "devices empty state",
)
old_metrics = """              <div className="ec-metric-list" style={{ marginTop: 14 }}>
                <div className="ec-metric-pair">
                  <small>Register sequence seen</small>
                  <strong>{device.lastSequenceSeen}</strong>
                </div>
                <div className="ec-metric-pair">
                  <small>Event Edge accepted through</small>
                  <strong>{device.edgeAcceptedThroughSequence}</strong>
                </div>
                <div className="ec-metric-pair">
                  <small>POS → Edge acceptance gap</small>
                  <strong>{edgeAcceptanceGap}</strong>
                </div>
                <div className="ec-metric-pair">
                  <small>Edge → Cloud backlog</small>
                  <strong>{device.edgeBacklogCount}</strong>
                </div>
                <div className="ec-metric-pair">
                  <small>Last Cloud delivery</small>
                  <strong>
                    {device.lastCloudDeliveryAt
                      ? ageLabel(device.lastCloudDeliveryAt)
                      : 'Not yet reported'}
                  </strong>
                </div>
              </div>
"""
new_metrics = """              <div className="ec-metric-list" style={{ marginTop: 14 }}>
                <div className="ec-metric-pair">
                  <small>Pending uploads</small>
                  <strong>{device.edgeBacklogCount}</strong>
                </div>
                <div className="ec-metric-pair">
                  <small>Last online update</small>
                  <strong>
                    {device.lastCloudDeliveryAt
                      ? ageLabel(device.lastCloudDeliveryAt)
                      : 'Not yet confirmed'}
                  </strong>
                </div>
              </div>

              <details className="ec-context-switcher" style={{ marginTop: 14 }}>
                <summary>Technical sync details</summary>
                <div className="ec-metric-list" style={{ marginTop: 12 }}>
                  <div className="ec-metric-pair">
                    <small>Register sequence seen</small>
                    <strong>{device.lastSequenceSeen}</strong>
                  </div>
                  <div className="ec-metric-pair">
                    <small>Event Edge accepted through</small>
                    <strong>{device.edgeAcceptedThroughSequence}</strong>
                  </div>
                  <div className="ec-metric-pair">
                    <small>POS → Edge acceptance gap</small>
                    <strong>{edgeAcceptanceGap}</strong>
                  </div>
                  <div className="ec-metric-pair">
                    <small>Edge → Cloud backlog</small>
                    <strong>{device.edgeBacklogCount}</strong>
                  </div>
                </div>
              </details>
"""
text = replace_once(text, old_metrics, new_metrics, "devices primary versus technical metrics")
path.write_text(text)


# Live command centre: mirror the same operator vocabulary.
path = Path("apps/control-web/src/app/command-centre/command-centre-client.tsx")
text = path.read_text()
helper_marker = "function SystemStatusRow({\n"
helper = """function registerStatusLabel(status: string): string {
  if (status === 'HEALTHY') return 'Reporting';
  if (status === 'DEGRADED') return 'Delayed';
  if (status === 'STALE') return 'Not reporting';
  return status;
}

function compactRegisterId(value: string): string {
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}…${value.slice(-5)}`;
}

"""
text = replace_once(text, helper_marker, helper + helper_marker, "command centre register helpers")
text = replace_once(text, "? 'Sync · no devices yet'", "? 'Registers · none seen yet'", "live no devices chip")
text = replace_once(text, "? 'Sync · all devices healthy'", "? 'Registers · all reporting'", "live healthy chip")
text = replace_once(
    text,
    ": `Sync · ${devices?.issues ?? 0} device issue(s)`",
    ": `Registers · ${devices?.issues ?? 0} need attention`",
    "live device issues chip",
)
text = replace_once(
    text,
    '<StatusChip tone="success" label="Local-first POS protected" />',
    '<StatusChip tone="success" label="Local sales do not depend on Cloud" />',
    "local sales protection chip",
)
text = replace_once(text, 'label="Device issues"', 'label="Register issues"', "live register issues KPI")
text = replace_once(
    text,
    "sub={`${devices?.degraded ?? 0} degraded · ${devices?.stale ?? 0} stale`}",
    "sub={`${devices?.degraded ?? 0} delayed · ${devices?.stale ?? 0} not reporting`}",
    "live register KPI detail",
)
text = replace_once(
    text,
    "inventory risk(s) · {devices?.issues ?? 0} device issue(s)",
    "inventory risk(s) · {devices?.issues ?? 0} register issue(s)",
    "live exception device wording",
)
text = replace_once(
    text,
    "No active alerts, inventory risks or device health exceptions are projected.",
    "No active alerts, inventory risks or register reporting exceptions are projected.",
    "live all clear wording",
)
text = replace_once(text, 'title="Device health"', 'title="Register health"', "live device panel title")
text = replace_once(
    text,
    'meta="Register heartbeat, backlog and locally committed sales visibility"',
    'meta="Which tills are reporting normally and which need connectivity attention"',
    "live device panel meta",
)
text = replace_once(text, '<span>Healthy</span>', '<span>Reporting</span>', "live reporting summary")
text = replace_once(text, '<span>Degraded</span>', '<span>Delayed</span>', "live delayed summary")
text = replace_once(text, '<span>Stale</span>', '<span>Not reporting</span>', "live stale summary")
text = replace_once(text, '<span>Total backlog</span>', '<span>Pending uploads</span>', "live backlog summary")
old_device_identity = """                              <span>
                                <strong>{device.deviceId}</strong>
                                <small>{device.salesLocationName ?? 'Unknown location'}</small>
                              </span>
"""
new_device_identity = """                              <span>
                                <strong>{device.salesLocationName ?? compactRegisterId(device.deviceId)}</strong>
                                <small>
                                  {device.salesLocationName
                                    ? `Register ${compactRegisterId(device.deviceId)}`
                                    : 'Location unavailable'}
                                </small>
                              </span>
"""
text = replace_once(text, old_device_identity, new_device_identity, "live register identity")
old_device_value = """                            <div className="ec-compact-row-value">
                              <strong>{device.status}</strong>
                              <small>
                                backlog {device.edgeBacklogCount} ·{' '}
                                {device.syncAgeSeconds === null
                                  ? 'no heartbeat'
                                  : `${device.syncAgeSeconds}s sync age`}
                              </small>
                            </div>
"""
new_device_value = """                            <div className="ec-compact-row-value">
                              <strong>{registerStatusLabel(device.status)}</strong>
                              <small>
                                {device.edgeBacklogCount} pending upload(s) ·{' '}
                                {device.syncAgeSeconds === null
                                  ? 'no recent report'
                                  : `last report ${device.syncAgeSeconds}s ago`}
                              </small>
                            </div>
"""
text = replace_once(text, old_device_value, new_device_value, "live register status details")
text = replace_once(text, 'label="Sync"', 'label="Registers"', "live system status label")
text = replace_once(
    text,
    "detail={`${devices?.healthy ?? 0} healthy · ${devices?.degraded ?? 0} degraded · ${devices?.stale ?? 0} stale`}",
    "detail={`${devices?.healthy ?? 0} reporting · ${devices?.degraded ?? 0} delayed · ${devices?.stale ?? 0} not reporting`}",
    "live system status details",
)
text = replace_once(text, 'label="Realtime"', 'label="Dashboard data"', "live realtime label")
path.write_text(text)
